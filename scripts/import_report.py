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
