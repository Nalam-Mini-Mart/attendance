# Nalam Payroll & Fast Ledger Calculator

A fast, zero-authentication, fully responsive web application for managing retail shift attendance, calculating exact overtime, tracking daily Credits and Debits with reasons, and computing net payroll payouts.

---

## 🖥️ Layout & Responsiveness

* **Desktop / Laptop View:** Expands to use the full screen (`max-w-7xl mx-auto`). Displays a 2-column dashboard:
  * **Main Left Column:** The Daily Ledger list with Month/Year controls, each day's hours, instant math split, daily rupee wage, Credit/Debit labels, and shift clear buttons.
  * **Sticky Right Sidebar:** Date Range picker with quick presets (*This Month*, *15 Days*, *30 Days*) and the live Net Payout Calculator Summary card.
* **Mobile View:** Naturally stacks into a clean mobile interface with touch-friendly cards and bottom-sheet adjustment dialogs.

---

## ⚡ Complete Features & CRUD Capabilities

### 1. Month / Year Selector & Full Month Ledger:
* **Month and Year Picker:** Select any month and year using the header controls or Previous/Next/Today buttons.
* **Full Month Display:** Generates rows for *every single day* of the chosen month (from 1st to 28th, 30th, or 31st), allowing shift and adjustment planning across past and future dates.

### 2. Time Formatting & Daily Wage Breakdown:
* **"Hours & Minutes" (`Xh Ym`) Display Everywhere:** All decimal durations (e.g., `12.17h`, `8.0 Hrs`) are converted to clean, intuitive `Xh Ym` representations:
  * Daily Ledger Cards: e.g. `12h 10m (10h 0m Reg + 2h 10m OT)` or `8h 0m (8h 0m Reg)`.
  * Total Net Payout Summary Card: Regular Hours and Overtime are both presented in `Xh Ym` (e.g., `80h 0m`, `14h 30m`).
  * Backend calculations retain full minute-level mathematical precision (`minutes / 60 * wage`).
* **Daily Wage Split Breakdown:** Instead of a single lump sum, the daily card displays the exact breakdown:
  * With Overtime: e.g., `(₹300 Reg + ₹162 OT) = ₹462 Total`
  * Regular Shift only: e.g., `(₹240 Reg) = ₹240 Total`
  * Guarantees exact mathematical consistency between Regular, OT, and Total components without rounding discrepancies.

### 3. Custom Hybrid Time Picker (12-Hour Format, Touch & Keyboard):
* **Custom Dropdown & Scroller Menu:** Tapping any segment or focusing via `Enter` immediately opens a sleek 3-column scroller dropdown (Hours `1-12`, Minutes `00-59`, `AM/PM`) with smooth touch-scrolling on mobile and mouse-scrolling on desktop.
* **Instant Number Snapping:** Typing a number (e.g. `8` or `12`) instantly updates the input and snaps/scrolls the dropdown column directly to that value (`08`, `12`).
* **Enter-Key Progression:** Pressing `Enter` confirms the current segment and advances (`Hour` ➡️ `Minute` ➡️ `AM/PM`). Pressing `Enter` on `AM/PM` closes the dropdown, commits the shift, and auto-scrolls/focuses into the next time picker (In ➡️ Out ➡️ Next Day In).
* **Arrow Keys Navigation:**
  * `←` / `→` (Left/Right Arrows): Seamlessly shifts focus back and forth between Hour, Minute, and AM/PM segments.
  * `↑` / `↓` (Up/Down Arrows): Scrolls and cycles through numbers/values in the currently active segment (1–12 wrap, 00–59 wrap, AM ⟷ PM).
* **Quick Letters on AM/PM:** Typing `A` sets `AM`, typing `P` sets `PM`.

### 4. Financial Entries (Credits & Debits):
* **Amount & Note / Reason:** Record Credits (e.g. `+ ₹200 (Bonus, Travel)`) and Debits (e.g. `- ₹100 (Cash Advance, Penalty)`) with dedicated reason notes.
* **Database Persistence:** Adjustments are written directly to Firestore (`setDoc` with merge) before modal dismissal, ensuring adjustments persist reliably across page reloads.
* **Summary Breakdown:** Clicking **Credits (+)** or **Debits (-)** in the summary card opens a popup detailing every date, note, and amount with direct **Edit** shortcuts.

### 5. Safe Deletions (Confirm Prompts):
* **Shift Erasure Confirmation:** Clicking the trash icon on a daily shift prompts `window.confirm` before clearing the recorded hours.
* **Financial Adjustments Confirmation:** Removing individual Credits, Debits, or clearing all financials requires user confirmation to prevent accidental data loss.
* **Staff Profile Cascade:** Deleting a staff member prompts confirmation and cascade-deletes all associated ledger documents from Cloud Firestore.

---

## 🚀 How to Run Locally

1. Double-click **`start.bat`** in this folder.
2. The server will launch and open `http://localhost:5000/` in your default browser.
