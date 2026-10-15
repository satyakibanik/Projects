"""Extract and reconcile a published NLDC daily workbook."""
import argparse
import datetime
import io
import json
import pathlib

import openpyxl


def parse_report(report_bytes, source_file):
    """Return dashboard data from workbook bytes and the source filename."""
    workbook = openpyxl.load_workbook(io.BytesIO(report_bytes), data_only=True)
    summary_sheet = workbook["P1"]
    raw_date = summary_sheet["D6"].value
    if isinstance(raw_date, (datetime.datetime, datetime.date)):
        report_date = raw_date.date() if isinstance(raw_date, datetime.datetime) else raw_date
    else:
        report_date = datetime.datetime.strptime(str(raw_date), "%d-%m-%Y").date()
    date = report_date.isoformat()

    number = lambda value: float(value) if isinstance(value, (int, float)) else None
    fuels = ["Gas", "Coal", "HFO", "HSD", "Hydro", "Solar", "Imports", "Wind"]
    regions = []
    for row in range(17, 26):
        i = row - 17
        regions.append(dict(
            name=summary_sheet.cell(row, 2).value.replace(" Zone", ""),
            energy_mwh=summary_sheet.cell(row, 13).value * 1000,
            fuels={fuel: summary_sheet.cell(row, col).value * 1000
                   for col, fuel in enumerate(fuels, 5)},
            shed_mw=summary_sheet.cell(60 + i, 7).value,
            demand_mw=summary_sheet.cell(60 + i, 9).value,
        ))

    plants, pending = [], []
    for row in workbook["P2"].iter_rows(min_row=11, max_row=workbook["P2"].max_row):
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
                capacity_mw=number(row[6].value),
                peak_mw=number(row[7].value),
                energy_mwh=number(row[8].value) / 1000 if number(row[8].value) is not None else None,
                remarks=str(row[9].value or "—"),
            ))

    hourly = []
    for row in workbook["P4"].iter_rows(min_row=9, max_row=33):
        hourly.append(dict(
            time=str(row[1].value)[:5],
            generation_mw=row[2].value,
            shed_mw=row[4].value,
            demand_mw=row[6].value,
        ))

    imports = []
    generation_log = workbook["GenLog"]
    for col in range(2, generation_log.max_column + 1):
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
    p3 = workbook["P3"]
    for row in range(17, p3.max_row + 1):
        for name_col, load_col, time_col in ((3, 4, 5), (7, 8, 9), (11, 12, 13)):
            name = p3.cell(row, name_col).value
            load = p3.cell(row, load_col).value
            if name and isinstance(load, (int, float)):
                substations.append(dict(name=str(name).strip(), load_mw=float(load),
                                        time=str(p3.cell(row, time_col).value or "—")[:5]))

    # Voltage sheet contains two parallel station lists. Class headings apply
    # independently to both blocks and are repeated in the source workbook.
    voltages = []
    voltage_sheet = workbook["Voltage"]
    voltage_classes = [None, None]
    for row in range(7, voltage_sheet.max_row + 1):
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
    ewic_sheet = workbook["EWIC"]
    for row in range(9, min(35, ewic_sheet.max_row + 1)):
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
    forecast_plants = []
    system_forecast = {}
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

    data = dict(
        date=date,
        source_file=source_file,
        timezone="Asia/Dhaka",
        summary=dict(
            peak_demand_mw=summary_sheet["E11"].value,
            peak_generation_mw=summary_sheet["E13"].value,
            peak_time="19:30",
            energy_mwh=summary_sheet["K8"].value * 1000,
            unserved_mwh=summary_sheet["K9"].value * 1000,
            temperature_c=summary_sheet["K11"].value,
            import_mwh=summary_sheet["K26"].value * 1000,
        ),
        fuels={fuel: summary_sheet.cell(26, col).value * 1000
               for col, fuel in enumerate(fuels, 5)},
        hourly=hourly,
        regions=regions,
        plants=plants,
        imports=imports,
        substations=substations,
        voltages=voltages,
        operations=dict(planned_shutdowns=planned_shutdowns, forced_shutdowns=forced_shutdowns,
                        events=events, ewic=ewic,
                        east_west=dict(energy_east_to_west_kwh=number(summary_sheet["E53"].value),
                                       energy_west_to_east_kwh=number(summary_sheet["E54"].value),
                                       peak_west_to_east_mw=number(summary_sheet["E55"].value),
                                       max_west_to_east_mw=number(summary_sheet["E56"].value))),
        forecast=dict(plants=forecast_plants, totals=system_forecast),
    )

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
