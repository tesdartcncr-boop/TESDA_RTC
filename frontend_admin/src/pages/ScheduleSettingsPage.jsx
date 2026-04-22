import WeeklySchedulePanel from "../components/WeeklySchedulePanel";

export default function ScheduleSettingsPage() {
  return (
    <WeeklySchedulePanel
      title="Weekly Schedule Calendar"
      description="Regular and Job Order each get their own date exception calendar. Use the monthly grid for red 10-hour dates, then edit Job Order's weekly rules below it."
      saveLabel="Save Weekly Schedule"
    />
  );
}
