"""Generate the static Transport Fever 3 vehicle site from the CSV files in data/."""

import argparse
import csv
import hashlib
import re
import shutil
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType

from jinja2 import Environment, FileSystemLoader, select_autoescape

ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data"
TEMPLATES_DIR = ROOT / "templates"
STATIC_DIR = ROOT / "static"

CATEGORIES = (
    "Road Vehicles",
    "Tram Railcars",
    "Tram Locomotives",
    "Tram Wagons",
    "Train Locomotives",
    "Train Multiple Units",
    "Train Wagons",
    "Ships",
    "Airplanes",
    "Helicopters",
)

UNITS: Mapping[str, str] = MappingProxyType(
    {
        "Speed": "km/h",
        "Power": "kW",
        "Weight": "t",
        "Length": "m",
        "Tractive Effort": "kN",
    }
)

LABELS: Mapping[str, str] = MappingProxyType({"Comfortability": "Comfort"})

# Captions under the large numbers on vehicle cards.
HERO_CAPTIONS: Mapping[str, str] = MappingProxyType(
    {
        "Capacity": "capacity",
        "Passenger Capacity": "passengers",
        "Cargo Capacity": "cargo",
        "Power": "power, kW",
        "Speed": "speed, km/h",
        "Cost": "cost",
        "Upkeep": "upkeep / year",
    }
)

MONEY_COLUMNS = frozenset({"Cost", "Upkeep"})
FILTER_COLUMNS = ("Payload", "Engine", "Size", "Light Rail")

# Payloads that can carry other payload types, so the filter matches them too.
CARGO = ("Bulk", "Flatbed", "Goods", "Liquid")
PAYLOAD_COVERS: Mapping[str, tuple[str, ...]] = MappingProxyType(
    {
        "All Cargo": CARGO,
        "No Liquid": ("Bulk", "Flatbed", "Goods"),
        "Everything": ("Passengers", "All Cargo", *CARGO),
    }
)
PAYLOAD_ORDER = ("Passengers", *CARGO, "No Liquid", "All Cargo", "Everything")

# Each rating column is merged with its numeric value column(s) into one cell:
# the value is shown inside a badge colored by the rating.
RATING_VALUES: Mapping[str, tuple[str, ...]] = MappingProxyType(
    {
        "Noise": ("Noise Value", "Locomotive Noise Value", "Car Noise Value"),
        "Pollution": (
            "Pollution Value",
            "Locomotive Pollution Value",
            "Car Pollution Value",
        ),
        "Comfortability": ("Comfort Value",),
    }
)
RATING_COLUMNS = frozenset(RATING_VALUES)
VALUE_COLUMNS = frozenset(key for keys in RATING_VALUES.values() for key in keys)

RATINGS: Mapping[str, int] = MappingProxyType(
    {"Very Poor": 1, "Poor": 2, "Mediocre": 3, "Good": 4, "Very Good": 5}
)

# End Year 0 (or empty) means the vehicle is never retired; sort it after every real year.
PRESENT_YEAR = 9999


@dataclass(frozen=True, slots=True)
class Cell:
    display: str
    sort: float | None = None
    rating: int | None = None
    title: str = ""


@dataclass(frozen=True, slots=True)
class Column:
    key: str
    label: str
    numeric: bool

    @property
    def rating(self) -> bool:
        return self.key in RATING_COLUMNS

    @property
    def short_label(self) -> str:
        return LABELS.get(self.key, self.key)

    @property
    def unit(self) -> str:
        return UNITS.get(self.key, "")


@dataclass(frozen=True, slots=True)
class CardLayout:
    """Column indices for each section of a vehicle card."""

    hero: tuple[tuple[int, str], ...]
    specs: tuple[int, ...]
    ratings: tuple[int, ...]
    tags: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class Vehicle:
    name: str
    cells: tuple[Cell, ...]
    attrs: Mapping[str, str]

    @property
    def years(self) -> str:
        end = int(self.attrs["end"])
        return f"{self.attrs['start']}–{'present' if end == PRESENT_YEAR else end}"


@dataclass(frozen=True, slots=True)
class Category:
    name: str
    slug: str
    columns: tuple[Column, ...]
    vehicles: tuple[Vehicle, ...]
    filters: Mapping[str, tuple[str, ...]]
    card: CardLayout

    @property
    def first_year(self) -> int:
        return min(int(v.attrs["start"]) for v in self.vehicles)

    @property
    def last_year(self) -> str:
        last = max(int(v.attrs["end"]) for v in self.vehicles)
        return "present" if last == PRESENT_YEAR else str(last)


def parse_number(raw: str) -> float | int | None:
    value = raw.lstrip("$")
    for kind in (int, float):
        try:
            return kind(value)
        except ValueError:
            pass
    return None


def format_number(raw: str, number: float | int) -> str:
    if isinstance(number, int):
        return f"{number:,}"
    decimals = len(raw.split(".")[1])
    return f"{number:,.{decimals}f}"


def make_cell(column: str, raw: str) -> Cell:
    raw = raw.strip()
    if column in RATING_COLUMNS:
        return Cell(raw, rating=RATINGS.get(raw))
    if column == "End Year" and raw in ("0", ""):
        return Cell("present", PRESENT_YEAR)
    if column in ("Name", *FILTER_COLUMNS):
        return Cell(raw)
    number = parse_number(raw)
    if number is None:
        return Cell(raw)
    if column == "Start Year" or column == "End Year":
        return Cell(str(number), number)
    display = format_number(raw, number)
    if column in MONEY_COLUMNS:
        display = "$" + display
    return Cell(display, number)


def merge_rating(key: str, cell: Cell, cells: Mapping[str, Cell]) -> Cell:
    values = tuple(cells[k] for k in RATING_VALUES[key] if k in cells)
    if cell.rating is None:
        # Cargo vehicles have no comfort rating, only a meaningless 0 value.
        return Cell("")
    if not values:
        return cell
    display = " / ".join(v.display for v in values)
    return Cell(display, values[0].sort, cell.rating, cell.display)


def merge_ratings(cells: Mapping[str, Cell]) -> Mapping[str, Cell]:
    return MappingProxyType(
        {
            key: merge_rating(key, cell, cells) if key in RATING_COLUMNS else cell
            for key, cell in cells.items()
            if key not in VALUE_COLUMNS
        }
    )


def column_label(key: str, keys: Sequence[str]) -> str:
    label = LABELS.get(key, key)
    if key in UNITS:
        return f"{label} ({UNITS[key]})"
    if key in RATING_COLUMNS:
        # Multiple units rate the locomotive and the cars separately.
        parts = tuple(k.split()[0].lower() for k in RATING_VALUES[key] if k in keys)
        if len(parts) > 1:
            return f"{label} ({' / '.join(parts)})"
    return label


def card_layout(columns: Sequence[Column]) -> CardLayout:
    """Pick which columns a card shows large (hero) and which as small specs."""
    index = {c.key: i for i, c in enumerate(columns)}
    # Helicopters have separate passenger and cargo capacities; locomotives carry
    # nothing, so their headline number is power. Cards show four large numbers.
    capacities = tuple(
        key
        for key in ("Capacity", "Passenger Capacity", "Cargo Capacity")
        if key in index
    )
    hero_keys = (*(capacities or ("Power",)), "Speed", "Cost", "Upkeep")[:4]
    skip = frozenset({"Name", "Start Year", "End Year", *hero_keys})
    return CardLayout(
        hero=tuple((index[key], HERO_CAPTIONS[key]) for key in hero_keys),
        specs=tuple(
            i
            for i, c in enumerate(columns)
            if c.numeric and not c.rating and c.key not in skip
        ),
        ratings=tuple(i for i, c in enumerate(columns) if c.rating),
        tags=tuple(i for i, c in enumerate(columns) if c.key in FILTER_COLUMNS),
    )


def hero_value(cell: Cell, column: Column) -> str:
    """Shorten millions on cards ("$27.27M"); the full value stays in the table."""
    if column.key in MONEY_COLUMNS and cell.sort is not None and cell.sort >= 1_000_000:
        return f"${cell.sort / 1_000_000:.2f}M"
    return cell.display


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def make_vehicle(keys: Sequence[str], row: Sequence[str]) -> Vehicle:
    cells = merge_ratings(
        {key: make_cell(key, raw) for key, raw in zip(keys, row, strict=True)}
    )
    filters = {
        slugify(key): cells[key].display for key in FILTER_COLUMNS if key in cells
    }
    if "payload" in filters:
        # Filter values this vehicle matches, "|"-separated.
        payload = filters["payload"]
        filters["payload"] = "|".join((payload, *PAYLOAD_COVERS.get(payload, ())))
    attrs = {
        "name": cells["Name"].display.lower(),
        "start": str(cells["Start Year"].sort),
        "end": str(cells["End Year"].sort),
        **filters,
    }
    return Vehicle(
        cells["Name"].display, tuple(cells.values()), MappingProxyType(attrs)
    )


def make_column(
    index: int, key: str, keys: Sequence[str], vehicles: Sequence[Vehicle]
) -> Column:
    values = tuple(v.cells[index] for v in vehicles if v.cells[index].display)
    numeric = bool(values) and all(c.sort is not None for c in values)
    return Column(key, column_label(key, keys), numeric)


def filter_options(key: str, vehicles: Sequence[Vehicle]) -> tuple[str, ...]:
    values = {value for v in vehicles for value in v.attrs[slugify(key)].split("|")}
    return tuple(
        sorted(
            values,
            key=lambda value: (
                PAYLOAD_ORDER.index(value) if value in PAYLOAD_ORDER else 0,
                value,
            ),
        )
    )


def load_category(name: str) -> Category:
    with (DATA_DIR / f"{name}.csv").open(encoding="utf-8", newline="") as f:
        # skipinitialspace keeps column-aligned files (padded around commas) parseable.
        reader = csv.reader(f, skipinitialspace=True)
        keys = tuple(h.strip() for h in next(reader))
        rows = tuple(tuple(row) for row in reader if any(cell.strip() for cell in row))

    vehicles = tuple(make_vehicle(keys, row) for row in rows)
    columns = tuple(
        make_column(i, key, keys, vehicles)
        for i, key in enumerate(k for k in keys if k not in VALUE_COLUMNS)
    )
    filters = MappingProxyType(
        {key: filter_options(key, vehicles) for key in FILTER_COLUMNS if key in keys}
    )
    return Category(
        name, slugify(name), columns, vehicles, filters, card_layout(columns)
    )


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:10]


def build(out: Path) -> None:
    categories = tuple(load_category(name) for name in CATEGORIES)

    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(STATIC_DIR, out / "static")
    (out / ".nojekyll").touch()

    env = Environment(
        loader=FileSystemLoader(TEMPLATES_DIR),
        autoescape=select_autoescape(),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    env.globals.update(
        categories=categories,
        total=sum(len(c.vehicles) for c in categories),
        version={p.name: file_hash(p) for p in STATIC_DIR.iterdir()},
        slugify=slugify,
        ratings=RATINGS,
    )
    env.filters["hero_value"] = hero_value

    # Each category lives in its own directory so URLs look like /road-vehicles/.
    # `root` is the relative path back to the site root, keeping links base-agnostic.
    index = env.get_template("index.html").render(current=None, root="")
    (out / "index.html").write_text(index, encoding="utf-8")
    for category in categories:
        page = env.get_template("category.html").render(current=category, root="../")
        (out / category.slug).mkdir()
        (out / category.slug / "index.html").write_text(page, encoding="utf-8")
        print(f"{category.name:<22} {len(category.vehicles):>3} vehicles")

    print(f"Built {len(categories) + 1} pages into {out}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out", type=Path, default=ROOT / "site", help="output directory"
    )
    build(parser.parse_args().out)


if __name__ == "__main__":
    main()
