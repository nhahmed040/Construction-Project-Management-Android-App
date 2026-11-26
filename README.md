# Construction Project Management (Android)

An offline-first Android app for running a construction project from bid to handover: **schedule, Gantt chart, manpower, equipment, cash flow and payments**, plus the BoQ, supplier bills, labour, client payment certificates and site diary.

It started as a copy of the [CashBook](https://github.com/nhahmed040/CashBook---Balance-Expense-) app. The cash-book tabs (Entries, Reports, books) were removed from the screens and replaced by the schedule module, which follows the contractor's schedule workbook (Man Power, Equipment, Cash Flow, Cash Flow Summary).

## Schedule module (project → tabs)

| Tab | What it does |
| --- | --- |
| **Schedule** | **The schedule is generated from the BoQ.** Import or add the BoQ, then tap *Generate schedule from BoQ*: each item is matched to a type of work (excavation, concrete, plastering, tiling ...) and gets a duration (quantity ÷ standard crew output per day), a crew, equipment and a material/labour split. Give a *finish by* date and the crews are scaled up until the plan fits. Tasks follow each other in BoQ order, Sunday (or Sat+Sun) is a rest day, and everything can be changed by tapping a task. |
| **Gantt** | Bar chart with parts, sections and tasks, planned vs actual progress strips, late tasks outlined in red, rest-day stripes, an as-of line and zoom. A *Progress vs plan* panel shows planned and actual progress, value ahead or behind, and the late tasks. Tap a bar to edit the task. |
| **Manpower** | Permanent and temporary types, people needed per task, peak people on site, man-days, a month grid and a daily histogram. |
| **Equipment** | Rented/owned machines per task, machine-days and a month grid. |
| **Cash flow** | Material / labour / equipment split per task, miscellaneous, overhead, profit, withholding tax and VAT; advance + interim + final payment schedule; planned value by month. |

**Start a project:** *Projects → New project*, or *New project from BoQ (Excel)* which reads your BoQ file, names the project after it and opens the Schedule tab. **Optional import:** if you already have a ready schedule workbook, *Schedule → Import a ready schedule* reads it with the contractor's layout (task sheet with `Task Name`/`Duration`/`Start`/`Finish` and a column per manpower type, an Equipment sheet, a Cash Flow sheet). **Export** writes Schedule, Man Power, Man Power Schedule, Equipment, Equipment Schedule, Cash Flow, Cash Flow Summary and Gantt sheets.

The work types and their outputs (`TEMPLATES` in `web/schedule.js`) were calibrated on the Badesa Corridor workbook: generating from its BoQ alone gives the same durations for most items (1, 3, 1, 5, 2, 25, 5, 8 days ...). They are starting values, so check them against your own productivity. Dates are tested in `tests/`.

## Everything else (from CashBook)

BoQ with progress and variation orders, interim payment certificates (VAT, retention, advance, withholding), supplier bills, daily labour, site diary, cash forecast, reminders and notifications, Excel/print exports, PIN lock, English / Afaan Oromoo / አማርኛ, Ethiopian calendar, optional Firebase sync and project sharing. The older release notes are in git history of CashBook.

> The new schedule screens are English only for now; Afaan Oromoo and Amharic fall back to English.
> The app id is `com.nhahmed.constructionpm`, so it installs next to CashBook. Google sign-in needs this package and the keystore SHA-1 registered in Firebase.
> Data is stored on the phone under its own key (`cpm.data.v1`); it does not read CashBook's data.

## Tests

```bash
node tests/schedule.test.js
```

## Build

GitHub Actions builds the APK on every push (Actions → *Build APK* → artifact `ConstructionPM-apk`). Locally: JDK 17, Android SDK, Gradle 8.7, `gradle assembleDebug`. Builds are signed with the fixed sideload key in `app/cashbook.keystore` (public on purpose, not for app stores).

## Layout

`web/` the app (`schedule.js`, `schedule-excel.js`, `schedule-ui.js`, `i18n-sched.js` are the schedule module; `logic.js` data model; `app.js` UI) · `app/` Android WebView wrapper · `tests/` Node tests · `firebase-rules.json` database rules.

## Scheduling rules

- **Links:** each task can follow up to 3 predecessors with FS, SS, FF or SF, plus a lag (wait) or a negative lag (lead, overlap) in working days. Tasks without links follow the BoQ order.
- **Critical path:** the forward and backward pass give each task its total float and free float. Tasks with no float are critical (marked in the list and on the Gantt) and the project completion date is shown.
- **Delays:** a task can be delayed by working days, and "Reschedule delayed tasks" pushes late work forward from the as-of date. Everything linked after it moves by itself.
- **Manual dates:** a task on a fixed date is never moved. If its links would need a later date, it is flagged instead.

## Cost split and withholding tax

- Cost shares: Miscellaneous 2%, Overhead 7.5%, Profit 7.5% and three direct shares, Material 65%, Labour 15%, Equipment 3% (they must add up to 100 minus the first three).
- Built-in presets (General 65/15/3, earthwork by machine or by hand, backfilling 40/20/23, mobilization, hardcore, lean and structural concrete, reinforcement, formwork, block masonry, plaster and painting, roofing, tiling, carpentry and metalwork, plumbing, electrical) fill the split for the project or for one task. They scale to fit if the indirect costs change. The BoQ generator gives each type of work its preset. You can save up to 8 presets of your own.
- Withholding tax (default 3%, the project's own setting) is not a cost share. It is taken off each payment, and the cash flow shows the net payment after withholding.
- Projects saved before this change keep working: the withholding points moved to Equipment.

## Task IDs

Every row of the schedule has an ID, its row number (1, 2, 3 ...), as in MS Project. Type predecessors with those IDs in the task editor: `3` (finish to start), `5SS+2`, `7FF-1`. Links are stored on the tasks themselves, so when rows are added or moved the IDs change but the links stay attached to the right tasks.

## Editing in the lists

The Schedule list and the Gantt show Qty, Days and Predecessors for every task. Tap Days to change a duration, tap Predecessors to type links (`3`, `5SS+2`, `7FF-1`); they save at once and the dates, bars and link lines update. Quantity comes from the BoQ and is read-only. The page and the Gantt keep their scroll position after a save. On the Manpower and Equipment pages the tasks come first; the types, the month grid and the daily chart are sections that fold.

## Smarter generation

*Generate* now opens a **preview** first: tick or untick items, change the type of work per item, and see finish date, man-days, peak people and critical tasks before anything is saved. Choose **Trade logic** (real links and overlaps between trades, e.g. plaster starts at 50% of the block work) or **Follow BoQ order**. Tasks with a manual date are kept unless you tick them.
**Productivity** (Schedule screen) lets you edit output per crew-day, crew, equipment and cost preset per type of work, plus hours per day (8 = table) and a site-difficulty factor. *Save as my default* makes new projects start with your set.

## Holidays

*Holidays* (Schedule screen) lists days off, single days or ranges. The schedule, Gantt and cash flow skip them like a rest day. One tap adds Ethiopia's fixed public holidays for the project years; Easter (Fasika), Eid and other moving days are added by hand.

## PDF export

*Export PDF* (Schedule screen) prints every sheet of the Excel export on A3 landscape: Schedule, Man Power, Man Power Schedule, Equipment, Equipment Schedule, Cash Flow, Cash Flow Summary and Gantt. Same layout, fills and equal row heights as the Excel file; header rows repeat on every page. On Android it uses the system print dialog (Save as PDF).

## Quick edit, Gantt gestures and Undo

Tap a task (list, Gantt row or bar, "This week") to open the **quick edit** sheet: − / + for days and delay, predecessors as chips (✕ removes, ＋ adds with link type and lag), *Full edit* for everything else. In the Gantt, drag the right end of a bar to change the duration, pinch to zoom, use Day / Week / Month and ⌖ Today. Every edit, drag and Generate shows **Undo**.

## Hierarchy and Gantt columns

The schedule shows four levels, each with its own style and indentation: **Group**, **Line**, **heading-type item** (an item with no quantity or rate, e.g. "Reinforced concrete…") and **item**. Items under a heading-type item (until the next item with a number, heading, line or group) are its sub-items; use *Put under heading / Take out of heading* in the quick-edit sheet to correct a guess. Heading levels are read-only and roll up start, finish, days, value and progress. Fold with ▾ / ▸ or *Expand all / Collapse all*; Excel and PDF indent the same way.

In the Gantt, *Columns* opens a list of check boxes: Qty, Days, Start, Finish, Predecessors, Successors (Start, Finish and Successors are calculated; the choice is remembered). The Excel Gantt sheet has a Successors column too.

### Presets

Setup ▾ → Presets (also a Presets button on Productivity, Manpower, Equipment and Cash flow). A preset bundles productivity, manpower, equipment and cash-flow set-ups. Apply per part with Replace or Merge (Undo available), optionally regenerate the schedule. Save the project's set-up as your own preset; rename, duplicate, delete (built-ins can be hidden). Presets are copied into the project and kept in settings/backup.
Built-in presets: Building, Road / corridor (kerb, cobble, terrazzo, asphalt, hardcore, road marking crews and machines, cost split), Rainy season, Remote site, Fast crews.
Presets can be shared as .json files (Presets → ⋯ → Share as file, Export my presets, Import presets). Imports are validated: size limit 200 KB, file version, up to 20 presets; a same name asks Keep both or Replace.
New project and New project from BoQ first ask for the project type: Building, Road / corridor, Blank, or any saved preset. The set-up of that preset is copied into the project; the last choice is remembered.
