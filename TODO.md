Session 1: Weight → Reps flow
- [ ] Type 225 in Weight → Enter → focus jumps to Reps
- [ ] Type 8 in Reps → Enter → set submits, fields clear
- [ ] Set 1 counter visible, PREV shows "—", Recent Sets shows [225 × 8]
- [ ] No keyboard lag or focus skips

Session 2: Exercise switching
- [ ] Change to Elliptical → fields switch to Duration + Calories
- [ ] Log 20 min × 150 cal
- [ ] Change back to Shoulder Press → fields switch to Weight + Reps
- [ ] Last session now shows history from Session 1 (if completed)

Session 3: Data reset
- [ ] Clear all data via Settings
- [ ] Reload → no "Last session" history
- [ ] Start fresh → clean state

---

## To Build: Settings Screen

### P1.2-01: Settings screen with clear data
- Add a Settings button to the idle screen
- Settings screen contains a single "Clear all data" action
- Tapping "Clear all data" shows a confirmation modal: "This will permanently delete all workout history." with "Delete" (danger) and "Cancel" buttons
- On confirm: wipe the SQLite DB from localStorage and reload the app to a clean state
- Settings screen follows existing design language (dark theme, bottom-sheet or full screen)
- No other settings needed for now
