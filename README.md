# Confluence — Policy-Integrated Admission & Treatment Intelligence

Hackathon prototype for: "Holistic Optimization System for Policy-Integrated
Admission & Treatment Intelligence"

A live hospital admission queue that ranks patients using a weighted,
multi-objective score across three layers:

- Clinical — patient risk/urgency
- Policy — insurance/government scheme eligibility match
- Resource — bed/ward capacity fit

Each recommendation is explainable: expanding a patient row shows a
"decision trace" diagram of how the three layers converged into the final
score, plus a plain-English rationale for the top-ranked driver.

## Run locally

npm install
npm run dev

Then open the local URL Vite prints (default: http://localhost:5173).

## Project structure

- index.html          entry HTML
- src/main.jsx         React root mount
- src/App.jsx          wraps the dashboard
- src/ConfluenceDashboard.jsx   main component (all logic + styling)
- src/index.css        base page reset

All patient data is mocked for demo purposes — no real patient data is used.
