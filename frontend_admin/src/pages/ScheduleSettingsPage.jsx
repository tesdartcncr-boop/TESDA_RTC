import WeeklySchedulePanel from "../components/WeeklySchedulePanel";

export default function ScheduleSettingsPage() {
  return (
    <WeeklySchedulePanel
      title="Weekly Schedule Calendar"
      description="Regular dates stay green for the default 8-hour rule; click any date to turn it red for a 10-hour exception, and click again to clear it. Job Order keeps the editable seven-day grid."
      saveLabel="Save Weekly Schedule"
    />
  );
}
