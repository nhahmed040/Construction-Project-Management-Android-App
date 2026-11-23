# Construction Project Management (Android)

An offline-first Android app for running a construction project from bid to handover: **schedule, Gantt chart, manpower, equipment, cash flow and payments**, plus the BoQ, supplier bills, labour, client payment certificates and site diary.

It started as a copy of the [CashBook](https://github.com/nhahmed040/CashBook---Balance-Expense-) app. The cash-book tabs (Entries, Reports, books) were removed from the screens and replaced by the schedule module, which follows the contractor's schedule workbook (Man Power, Equipment, Cash Flow, Cash Flow Summary).

## Schedule module (project → tabs)

| Tab | What it does |
| --- | --- |
| **Schedule** | Tasks come from the BoQ. Each task has a duration (working days) and starts after the previous task, with it, or on a fixed date. Sunday (or Sat+Sun) is a rest day. **Auto-plan** spreads the project days by task value. |
| **Gantt** | Bar chart with parts, sections and tasks, planned vs actual progress strips, late tasks outlined in red, rest-day stripes, an as-of line and zoom. A *Progress vs plan* panel shows planned and actual progress, value ahead or behind, and the late tasks. Tap a bar to edit the task. |
| **Manpower** | Permanent and temporary types, people needed per task, peak people on site, man-days, a month grid and a daily histogram. |
| **Equipment** | Rented/owned machines per task, machine-days and a month grid. |
| **Cash flow** | Material / labour / equipment split per task, miscellaneous, overhead, profit, withholding tax and VAT; advance + interim + final payment schedule; planned value by month. |

**Import:** *Projects → New project from schedule Excel* (or *Schedule → Import schedule*) reads a workbook with the contractor's layout (task sheet with `Task Name`/`Duration`/`Start`/`Finish` and a column per manpower type, an Equipment sheet, a Cash Flow sheet). **Export** writes Schedule, Man Power, Man Power Schedule, Equipment, Equipment Schedule, Cash Flow, Cash Flow Summary and Gantt sheets.

Working-day dates are checked against the Badesa Corridor workbook (see `tests/`).

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
