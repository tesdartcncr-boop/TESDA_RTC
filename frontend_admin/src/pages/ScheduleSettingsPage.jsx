import ScheduleOverridePanel from "../components/ScheduleOverridePanel";

export default function ScheduleSettingsPage() {
  return (
    <ScheduleOverridePanel
      title="Schedule and Late Threshold Override"
      description="Set the date-specific schedule that drives late and undertime calculations across the employee sheets."
      saveLabel="Save Override"
    />
  );
}
