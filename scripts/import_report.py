"""Extract and reconcile a published NLDC daily workbook."""
import argparse
import datetime
import io
import json
import pathlib
import re
import unicodedata

import openpyxl


def parse_report(report_bytes, source_file):
    """Return dashboard data from workbook bytes and the source filename."""
    workbook = openpyxl.load_workbook(io.BytesIO(report_bytes), data_only=True)
    summary_sheet = workbook["P1"]
    legacy_layout = "P4" not in workbook.sheetnames
    raw_date = summary_sheet["D6"].value
    if legacy_layout:
        # Older reports keep the operating date in P2 and may use P1!D6 for
        # an unrelated historical peak date.
        raw_date = workbook["P2"]["D4"].value or summary_sheet["D7"].value
    if isinstance(raw_date, (datetime.datetime, datetime.date)):
        report_date = raw_date.date() if isinstance(raw_date, datetime.datetime) else raw_date
    else:
        report_date = datetime.datetime.strptime(str(raw_date), "%d-%m-%Y").date()
    date = report_date.isoformat()

    number = lambda value: float(value) if isinstance(value, (int, float)) else None
    def plant_key(name):
        text = unicodedata.normalize("NFKD", str(name or "")).encode("ascii", "ignore").decode().lower()
        return re.sub(r"[^a-z0-9]", "", text)

    def installed_capacity(value):
        if isinstance(value, (int, float)):
            return float(value)
        if not isinstance(value, str):
            return None
        text = value.replace(",", "").lower().replace("×", "*").replace("x", "*")
        products = re.findall(r"(\d+(?:\.\d+)?)\s*\*\s*(\d+(?:\.\d+)?)", text)
        if products:
            return sum(float(units) * float(mw) for units, mw in products)
        match = re.search(r"\d+(?:\.\d+)?", text)
        return float(match.group()) if match else None

    def source_match(mapping, name):
        key = plant_key(name)
        if key in mapping:
            return mapping[key]
        base = re.sub(r"\s*\((?:gas|hsd|hfo|diesel|coal)\)\s*$", "", str(name or ""), flags=re.I).strip()
        return mapping.get(plant_key(base))

    fuels = ["Gas", "Coal", "HFO", "HSD", "Hydro", "Solar", "Imports", "Wind"]
    regions = []
    if not legacy_layout:
        for row in range(17, 26):
            i = row - 17
            name = summary_sheet.cell(row, 2).value
            energy = number(summary_sheet.cell(row, 13).value)
            if not name or energy is None:
                continue
            regions.append(dict(
                name=str(name).replace(" Zone", ""),
                energy_mwh=energy * 1000,
                fuels={fuel: (number(summary_sheet.cell(row, col).value) or 0) * 1000
                       for col, fuel in enumerate(fuels, 5)},
                shed_mw=number(summary_sheet.cell(60 + i, 7).value),
                demand_mw=number(summary_sheet.cell(60 + i, 9).value),
            ))
    elif "P3" in workbook.sheetnames:
        # Legacy P3 has regional demand snapshots but no regional energy data.
        p3 = workbook["P3"]
        for row in range(9, 14):
            for name_col, demand_col in ((2, 5), (8, 12)):
                name, demand = p3.cell(row, name_col).value, number(p3.cell(row, demand_col).value)
                if name and demand is not None:
                    name = re.sub(r"^\s*[ivx]+\)\s*", "", str(name), flags=re.I).strip()
                    regions.append(dict(name=name, energy_mwh=None, fuels={fuel: None for fuel in fuels},
                                        shed_mw=None, demand_mw=demand))

    plants, pending = [], []
    p2_sheet = workbook["P2"]
    for row in p2_sheet.iter_rows(min_row=9 if legacy_layout else 11, max_row=p2_sheet.max_row):
        name, label = row[2].value, row[1].value
        if isinstance(label, str) and label.endswith(" Area Total"):
            region = label.replace(" Area Total", "")
            for plant in pending:
                plant["region"] = region
            plants.extend(pending)
            pending = []
        elif isinstance(name, str) and isinstance(row[6].value, (int, float)):
            pending.append(dict(
                name=name,
                producer=row[4].value,
                installed_capacity_mw=installed_capacity(row[5].value),
                capacity_mw=number(row[6].value),
                present_capacity_mw=number(row[6].value),
                peak_mw=number(row[7].value),
                energy_mwh=number(row[8].value) / 1000 if number(row[8].value) is not None else None,
                remarks=str(row[9].value or "—"),
            ))
    if pending:
        plants.extend(pending)

    dispatch_hourly = []
    if "P4" in workbook.sheetnames:
        for row in workbook["P4"].iter_rows(min_row=9, max_row=33):
            dispatch_hourly.append(dict(
                time=str(row[1].value)[:5],
                generation_mw=row[2].value,
                shed_mw=row[4].value,
                demand_mw=row[6].value,
            ))
    elif "L-Curve" in workbook.sheetnames:
        # Older workbooks provide half-hour total generation in L-Curve, not
        # the newer P4 table. Preserve whole-hour generation points; demand
        # and shedding are unavailable at hourly resolution in this format.
        curve = workbook["L-Curve"]
        for row in range(4, curve.max_row + 1):
            raw_time = curve.cell(row, 1).value
            if raw_time is None:
                continue
            time = raw_time.strftime("%H:%M") if hasattr(raw_time, "strftime") else str(raw_time)[:5]
            generation = number(curve.cell(row, 5).value)
            if generation is not None and (time.endswith(":00") or time == "24:00"):
                dispatch_hourly.append(dict(time=time, generation_mw=generation,
                                            shed_mw=None, demand_mw=None))

    grid_curve = []
    curve_sheet = workbook["L-Curve"] if "L-Curve" in workbook.sheetnames else None
    if curve_sheet is not None:
        for row in range(4, curve_sheet.max_row + 1):
            raw_time = curve_sheet.cell(row, 1).value
            if raw_time is None:
                continue
            time = raw_time.strftime("%H:%M") if hasattr(raw_time, "strftime") else str(raw_time)[:5]
            curve_columns = (3, 4, 5) if legacy_layout else (2, 3, 4)
            east_mw, west_mw, total_mw = (number(curve_sheet.cell(row, col).value) for col in curve_columns)
            if east_mw is not None and west_mw is not None and total_mw is not None:
                grid_curve.append(dict(time=time, east_grid_mw=east_mw, west_grid_mw=west_mw, total_mw=total_mw))

        curve_by_time = {point["time"]: point for point in grid_curve}
        generation_deltas = [
            abs(number(point["generation_mw"]) - curve_by_time[point["time"]]["total_mw"])
            for point in dispatch_hourly
            if point["time"] in curve_by_time and number(point["generation_mw"]) is not None
        ]
        assert generation_deltas and max(generation_deltas) < 0.01, \
            "L-Curve total generation does not reconcile with P4 generation"

    p2_by_name = {plant_key(plant["name"]): plant for plant in plants}
    forecast_sheet = workbook["Forecast"]
    forecast_by_name = {}
    for row in range(11, forecast_sheet.max_row + 1):
        forecast_name = forecast_sheet.cell(row, 2).value
        if forecast_name and not str(forecast_name).strip().lower().endswith("area total"):
            forecast_by_name[plant_key(forecast_name)] = dict(
                fuel=str(forecast_sheet.cell(row, 3).value or "—").strip(),
                producer=str(forecast_sheet.cell(row, 4).value or "—").strip(),
            )

    generation_log = workbook["GenLog"] if "GenLog" in workbook.sheetnames else None
    plant_units = []
    for col in range(2, generation_log.max_column + 1) if generation_log is not None else []:
        name = str(generation_log.cell(11, col).value or "").strip()
        if not name or name.lower().endswith("total"):
            continue
        if any(token in name.lower() for token in ["hvdc", "tripura", "adani", "nepal"]):
            continue

        raw_capacity = generation_log.cell(12, col).value
        capacity = number(raw_capacity)
        if capacity is None and isinstance(raw_capacity, str):
            match = re.search(r"[-+]?\d[\d,]*(?:\.\d+)?", raw_capacity)
            capacity = float(match.group(0).replace(",", "")) if match else None

        plant_hourly = []
        for row in range(13, 38):
            raw_time, mw = generation_log.cell(row, 1).value, generation_log.cell(row, col).value
            if raw_time is None:
                continue
            time = raw_time.strftime("%H:%M") if hasattr(raw_time, "strftime") else str(raw_time)[:5]
            plant_hourly.append(dict(time=time, mw=number(mw)))
        values = [row["mw"] for row in plant_hourly if row["mw"] is not None]
        peak = max(values) if values else None
        energy_kwh = number(generation_log.cell(38, col).value)
        p2 = source_match(p2_by_name, name) or {}
        forecast = source_match(forecast_by_name, name) or {}
        energy_mwh = energy_kwh / 1000 if energy_kwh is not None else None
        operating_hours = sum(
            row["time"].endswith(":00") and row["mw"] is not None and row["mw"] > 0
            for row in plant_hourly
        )
        installed_mw = p2.get("installed_capacity_mw")
        plant_units.append(dict(
            name=name,
            capacity_mw=capacity,
            installed_capacity_mw=installed_mw,
            present_capacity_mw=p2.get("present_capacity_mw"),
            peak_mw=peak,
            peak_generation_mw=peak,
            capacity_factor_pct=energy_mwh / (installed_mw * 24) * 100 if energy_mwh is not None and installed_mw else None,
            puf_pct=energy_mwh / (installed_mw * operating_hours) * 100 if energy_mwh is not None and installed_mw and operating_hours else None,
            utilization_ratio_pct=peak / installed_mw * 100 if peak is not None and installed_mw else None,
            operating_hours=int(operating_hours),
            utilization_pct=peak / capacity * 100 if peak is not None and capacity else None,
            energy_mwh=energy_mwh,
            fuel=forecast.get("fuel", "—"),
            producer=forecast.get("producer", p2.get("producer", "—")),
            status="running" if any(value > 0 for value in values) else "no-output",
            hourly=plant_hourly,
        ))

    if generation_log is None and "Generation" in workbook.sheetnames:
        # Legacy Generation is transposed: one plant per row, time by column.
        generation_log = workbook["Generation"]
        for row in range(3, generation_log.max_row + 1):
            raw_name = generation_log.cell(row, 2).value
            if not isinstance(raw_name, str) or not raw_name.strip():
                continue
            name, plant_hourly = raw_name.strip(), []
            for col in range(3, min(26, generation_log.max_column) + 1):
                raw_time = generation_log.cell(2, col).value
                if raw_time is None:
                    continue
                time = raw_time.strftime("%H:%M") if hasattr(raw_time, "strftime") else str(raw_time)[:5]
                plant_hourly.append(dict(time=time, mw=number(generation_log.cell(row, col).value)))
            values = [point["mw"] for point in plant_hourly if point["mw"] is not None]
            peak = max(values) if values else None
            p2 = source_match(p2_by_name, name) or {}
            installed = p2.get("installed_capacity_mw")
            energy_mwh = sum(values) if values else None
            operating_hours = sum(point["time"].endswith(":00") and point["mw"] is not None and point["mw"] > 0
                                  for point in plant_hourly)
            plant_units.append(dict(
                name=name, capacity_mw=p2.get("capacity_mw"), installed_capacity_mw=installed,
                present_capacity_mw=p2.get("present_capacity_mw"), peak_mw=peak, peak_generation_mw=peak,
                capacity_factor_pct=energy_mwh / (installed * 24) * 100 if energy_mwh is not None and installed else None,
                puf_pct=energy_mwh / (installed * operating_hours) * 100 if energy_mwh is not None and installed and operating_hours else None,
                utilization_ratio_pct=peak / installed * 100 if peak is not None and installed else None,
                operating_hours=int(operating_hours),
                utilization_pct=peak / p2["capacity_mw"] * 100 if peak is not None and p2.get("capacity_mw") else None,
                energy_mwh=energy_mwh, fuel="—", producer=p2.get("producer", "—"),
                status="running" if any(value > 0 for value in values) else "no-output", hourly=plant_hourly,
            ))

    imports = []
    for col in range(2, generation_log.max_column + 1) if "GenLog" in workbook.sheetnames else []:
        name = str(generation_log.cell(11, col).value or "")
        if any(token in name.lower() for token in ["hvdc", "tripura", "adani", "nepal"]):
            if isinstance(generation_log.cell(38, col).value, (int, float)):
                imports.append(dict(
                    name=name,
                    energy_mwh=generation_log.cell(38, col).value / 1000,
                    hourly=[dict(time=str(generation_log.cell(row, 1).value),
                                 mw=generation_log.cell(row, col).value)
                            for row in range(13, 38)],
                ))

    # P3 lists three side-by-side blocks of substations and their maximum
    # served load/time. Keep the source time because each station peaks at a
    # different hour.
    substations = []
    p3 = workbook["P3"] if "P3" in workbook.sheetnames else None
    for row in range(17, p3.max_row + 1) if p3 is not None else []:
        for name_col, load_col, time_col in ((3, 4, 5), (7, 8, 9), (11, 12, 13)):
            name = p3.cell(row, name_col).value
            load = p3.cell(row, load_col).value
            if name and isinstance(load, (int, float)):
                substations.append(dict(name=str(name).strip(), load_mw=float(load),
                                        time=str(p3.cell(row, time_col).value or "—")[:5]))

    # Voltage sheet contains two parallel station lists. Class headings apply
    # independently to both blocks and are repeated in the source workbook.
    voltages = []
    voltage_sheet = workbook["Voltage"] if "Voltage" in workbook.sheetnames else None
    voltage_classes = [None, None]
    for row in range(7, voltage_sheet.max_row + 1) if voltage_sheet is not None else []:
        for block, start_col in enumerate((1, 6)):
            class_label = voltage_sheet.cell(row, start_col).value
            if isinstance(class_label, str) and "kV" in class_label:
                voltage_classes[block] = class_label.strip()
                continue
            name = voltage_sheet.cell(row, start_col).value
            maximum = voltage_sheet.cell(row, start_col + 1).value
            minimum = voltage_sheet.cell(row, start_col + 3).value
            if name and isinstance(maximum, (int, float)) and isinstance(minimum, (int, float)):
                def voltage_time(value):
                    return value.strftime("%H:%M") if hasattr(value, "strftime") else str(value or "—")[:5]
                voltages.append(dict(
                    name=str(name).strip(), voltage_class=voltage_classes[block] or "Unknown",
                    max_kv=float(maximum), max_time=voltage_time(voltage_sheet.cell(row, start_col + 2).value),
                    min_kv=float(minimum), min_time=voltage_time(voltage_sheet.cell(row, start_col + 4).value),
                ))

    # P1's availability tables and event log are published as two columns of
    # report content; combine wrapped event description lines into one entry.
    planned_shutdowns, forced_shutdowns = [], []
    for row in range(74, 81):
        planned_name, planned_capacity = summary_sheet.cell(row, 4).value, summary_sheet.cell(row, 7).value
        forced_name, forced_capacity = summary_sheet.cell(row, 9).value, summary_sheet.cell(row, 12).value
        if planned_name and isinstance(planned_capacity, (int, float)):
            planned_shutdowns.append(dict(name=str(planned_name).strip(), capacity_mw=float(planned_capacity)))
        if forced_name and isinstance(forced_capacity, (int, float)):
            forced_shutdowns.append(dict(name=str(forced_name).strip(), capacity_mw=float(forced_capacity)))
    events = []
    event_row = None
    for row in range(85, summary_sheet.max_row + 1):
        outage = summary_sheet.cell(row, 2).value
        restoration = summary_sheet.cell(row, 3).value
        description = summary_sheet.cell(row, 4).value
        if description:
            if outage or restoration or event_row is None:
                event_row = dict(outage_time=str(outage or "—")[:5],
                                 restoration_time=str(restoration or "—")[:5],
                                 description=str(description).strip())
                events.append(event_row)
            else:
                event_row["description"] += " " + str(description).strip()
        elif outage or restoration:
            event_row = None

    # EWIC hourly active-power flows. Positive values are west-to-east and
    # negative values are east-to-west, as noted in the workbook itself.
    ewic = []
    ewic_sheet = workbook["EWIC"] if "EWIC" in workbook.sheetnames else None
    for row in range(9, min(35, ewic_sheet.max_row + 1)) if ewic_sheet is not None else []:
        raw_time = ewic_sheet.cell(row, 1).value
        if raw_time is None:
            continue
        time_text = raw_time.strftime("%H:%M") if hasattr(raw_time, "strftime") else str(raw_time)[:5]
        ewic.append(dict(time=time_text, ishwardi_ghorashal=number(ewic_sheet.cell(row, 2).value),
                         sirajganj_sreepur=number(ewic_sheet.cell(row, 4).value),
                         gopalganj_aminbazar=number(ewic_sheet.cell(row, 6).value)))

    # Forecast includes one row per generating unit followed by area totals
    # and a system total. The system total row provides the peak summaries.
    forecast_sheet = workbook["Forecast"]
    raw_forecast_date = forecast_sheet["C6"].value
    if legacy_layout:
        raw_forecast_date = forecast_sheet["E3"].value or forecast_sheet["L2"].value
    if isinstance(raw_forecast_date, (datetime.datetime, datetime.date)):
        forecast_date = (raw_forecast_date.date() if isinstance(raw_forecast_date, datetime.datetime)
                         else raw_forecast_date).isoformat()
    else:
        forecast_date = datetime.datetime.strptime(str(raw_forecast_date), "%d-%m-%Y").date().isoformat()
    forecast_plants = []
    system_forecast = {}
    from pgcb_forecast import scenario_from_sheet
    scenario_date, forecast_demand_hourly = scenario_from_sheet(forecast_sheet)
    for row in range(11, forecast_sheet.max_row + 1):
        name = forecast_sheet.cell(row, 2).value
        if forecast_sheet.cell(row, 1).value == "System Total" or name == "System Total":
            system_forecast = dict(
                forecast_day_mw=number(forecast_sheet.cell(row, 10).value),
                forecast_evening_mw=number(forecast_sheet.cell(row, 11).value),
                effective_day_mw=number(forecast_sheet.cell(row, 12).value),
                effective_evening_mw=number(forecast_sheet.cell(row, 13).value),
            )
        elif name and not str(name).strip().lower().endswith("area total") and isinstance(forecast_sheet.cell(row, 6).value, (int, float)):
            forecast_plants.append(dict(
                name=str(name).strip(), fuel=str(forecast_sheet.cell(row, 3).value or "—"),
                producer=str(forecast_sheet.cell(row, 4).value or "—"),
                capacity_mw=number(forecast_sheet.cell(row, 6).value),
                actual_day_mw=number(forecast_sheet.cell(row, 8).value),
                actual_evening_mw=number(forecast_sheet.cell(row, 9).value),
                forecast_day_mw=number(forecast_sheet.cell(row, 10).value),
                forecast_evening_mw=number(forecast_sheet.cell(row, 11).value),
                effective_day_mw=number(forecast_sheet.cell(row, 12).value),
                effective_evening_mw=number(forecast_sheet.cell(row, 13).value),
                remarks=str(forecast_sheet.cell(row, 14).value or "—").strip(),
            ))

    # Half-hourly generation by source and shortage from the En-Curve sheet.
    en_curve = None
    if "En-Curve" in workbook.sheetnames:
        en_curve_sheet = workbook["En-Curve"]
        raw_curve_date = en_curve_sheet.cell(2, 2).value
        if isinstance(raw_curve_date, (datetime.datetime, datetime.date)):
            curve_date = (raw_curve_date.date() if isinstance(raw_curve_date, datetime.datetime)
                          else raw_curve_date).isoformat()
        else:
            curve_date = datetime.datetime.strptime(str(raw_curve_date), "%d-%m-%Y").date().isoformat()
        curve_sources = []
        for col in range(2, 18):
            label = str(en_curve_sheet.cell(3, col).value or "").strip()
            if not label:
                continue
            key = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_") + "_mw"
            curve_sources.append(dict(key=key, name=label))
        en_curve_hourly = []
        for row in range(4, en_curve_sheet.max_row + 1):
            raw_time = en_curve_sheet.cell(row, 1).value
            if raw_time is None:
                continue
            time_text = raw_time.strftime("%H:%M") if hasattr(raw_time, "strftime") else str(raw_time)[:5]
            reading = {source["key"]: number(en_curve_sheet.cell(row, col).value)
                       for source, col in zip(curve_sources, range(2, 18))}
            generated = sum(value or 0 for key, value in reading.items() if key != "shortage_mw")
            en_curve_hourly.append(dict(time=time_text, **reading, total_generation_mw=generated))
        en_curve = dict(
            date=curve_date,
            sources=curve_sources,
            hourly=en_curve_hourly,
            totals=dict(
                energy_generated_mwh=number(en_curve_sheet.cell(7, 21).value) * 1000
                if number(en_curve_sheet.cell(7, 21).value) is not None else None,
                energy_not_served_mwh=number(en_curve_sheet.cell(8, 21).value) * 1000
                if number(en_curve_sheet.cell(8, 21).value) is not None else None,
                total_requirement_mwh=number(en_curve_sheet.cell(9, 21).value) * 1000
                if number(en_curve_sheet.cell(9, 21).value) is not None else None,
            ),
        )

    data = dict(
        date=date,
        source_file=source_file,
        timezone="Asia/Dhaka",
        summary=dict(
            peak_demand_mw=(number(summary_sheet["D10"].value) if legacy_layout else summary_sheet["E11"].value),
            peak_generation_mw=(number(summary_sheet["D9"].value) if legacy_layout else summary_sheet["E13"].value),
            peak_time=(str(summary_sheet["F9"].value)[:5] if legacy_layout else "19:30"),
            energy_mwh=(number(summary_sheet["D12"].value) * 1000 if legacy_layout else summary_sheet["K8"].value * 1000),
            unserved_mwh=(None if legacy_layout else summary_sheet["K9"].value * 1000),
            temperature_c=(None if legacy_layout else summary_sheet["K11"].value),
            import_mwh=(None if legacy_layout else summary_sheet["K26"].value * 1000),
        ),
        fuels=({fuel: None for fuel in fuels} if legacy_layout else
               {fuel: (number(summary_sheet.cell(26, col).value) or 0) * 1000
                for col, fuel in enumerate(fuels, 5)}),
        hourly=dispatch_hourly,
        grid_generation=grid_curve,
        en_curve=en_curve,
        regions=regions,
        plants=plants,
        plant_units=plant_units,
        imports=imports,
        substations=substations,
        voltages=voltages,
        operations=dict(planned_shutdowns=planned_shutdowns, forced_shutdowns=forced_shutdowns,
                        events=events, ewic=ewic,
                        east_west=dict(energy_east_to_west_kwh=number(summary_sheet["E53"].value),
                                       energy_west_to_east_kwh=number(summary_sheet["E54"].value),
                                       peak_west_to_east_mw=number(summary_sheet["E55"].value),
                                       max_west_to_east_mw=number(summary_sheet["E56"].value))),
        forecast=dict(date=forecast_date, scenario_date=scenario_date, plants=forecast_plants, totals=system_forecast,
                      demand_hourly=forecast_demand_hourly),
    )

    if not legacy_layout:
        assert abs(sum(plant["energy_mwh"] for plant in plants) - data["summary"]["energy_mwh"]) < 0.1, \
            "Plant energy does not reconcile"
        assert abs(sum(data["fuels"].values()) - data["summary"]["energy_mwh"]) < 0.1, \
            "Fuel energy does not reconcile"
        assert abs(sum(region["energy_mwh"] for region in regions) - data["summary"]["energy_mwh"]) < 0.1, \
            "Regional energy does not reconcile"
        assert abs(sum(route["energy_mwh"] for route in imports) - data["summary"]["import_mwh"]) < 0.1, \
            "Import energy does not reconcile"
    return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("report")
    args = parser.parse_args()
    report = pathlib.Path(args.report)
    data = parse_report(report.read_bytes(), report.name)

    output_dir = pathlib.Path(__file__).resolve().parents[1] / "prototype" / "data"
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / f"{data['date']}.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2)
    )
    dates = sorted(
        (path.stem for path in output_dir.glob("????-??-??.json")), reverse=True
    )
    (output_dir / "index.json").write_text(json.dumps(dates))
    print(f"Imported {data['date']}: {len(data['plants'])} plants, "
          f"{len(data['regions'])} regions, {len(data['imports'])} import routes. Totals reconciled.")


if __name__ == "__main__":
    main()
