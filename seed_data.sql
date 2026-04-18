-- DTR Automation Seed Data
-- Run this file after supabase_schema.sql

truncate table attendance, schedule_settings, notifications, backup_logs, employees restart identity cascade;

insert into employees (id, first_name, second_name, last_name, extension, employee_password_hash, name, category) values
(1, 'Alicia', null, 'Ramos', null, 'pbkdf2_sha256$120000$ZHRyLXNlZWQtc2FsdC0yMDI2$c2AonrD+vUjxIcIH7gQ9Ei0eYz4+XP0sdH2RgDc9B4E=', 'Alicia Ramos', 'regular'),
(2, 'Brandon', null, 'Cruz', null, 'pbkdf2_sha256$120000$ZHRyLXNlZWQtc2FsdC0yMDI2$c2AonrD+vUjxIcIH7gQ9Ei0eYz4+XP0sdH2RgDc9B4E=', 'Brandon Cruz', 'regular'),
(3, 'Celia', null, 'Navarro', null, 'pbkdf2_sha256$120000$ZHRyLXNlZWQtc2FsdC0yMDI2$c2AonrD+vUjxIcIH7gQ9Ei0eYz4+XP0sdH2RgDc9B4E=', 'Celia Navarro', 'regular'),
(4, 'Daryl', null, 'Mendoza', null, 'pbkdf2_sha256$120000$ZHRyLXNlZWQtc2FsdC0yMDI2$c2AonrD+vUjxIcIH7gQ9Ei0eYz4+XP0sdH2RgDc9B4E=', 'Daryl Mendoza', 'regular'),
(5, 'Erika', null, 'Santos', null, 'pbkdf2_sha256$120000$ZHRyLXNlZWQtc2FsdC0yMDI2$c2AonrD+vUjxIcIH7gQ9Ei0eYz4+XP0sdH2RgDc9B4E=', 'Erika Santos', 'regular'),
(6, 'Felix', null, 'Alonzo', null, 'pbkdf2_sha256$120000$ZHRyLXNlZWQtc2FsdC0yMDI2$c2AonrD+vUjxIcIH7gQ9Ei0eYz4+XP0sdH2RgDc9B4E=', 'Felix Alonzo', 'regular'),
(7, 'Grace', null, 'Lim', null, 'pbkdf2_sha256$120000$ZHRyLXNlZWQtc2FsdC0yMDI2$c2AonrD+vUjxIcIH7gQ9Ei0eYz4+XP0sdH2RgDc9B4E=', 'Grace Lim', 'jo'),
(8, 'Hector', 'Dela', 'Pena', null, 'pbkdf2_sha256$120000$ZHRyLXNlZWQtc2FsdC0yMDI2$c2AonrD+vUjxIcIH7gQ9Ei0eYz4+XP0sdH2RgDc9B4E=', 'Hector Dela Pena', 'jo'),
(9, 'Irene', null, 'Gomez', null, 'pbkdf2_sha256$120000$ZHRyLXNlZWQtc2FsdC0yMDI2$c2AonrD+vUjxIcIH7gQ9Ei0eYz4+XP0sdH2RgDc9B4E=', 'Irene Gomez', 'jo'),
(10, 'Jomar', null, 'Velasco', null, 'pbkdf2_sha256$120000$ZHRyLXNlZWQtc2FsdC0yMDI2$c2AonrD+vUjxIcIH7gQ9Ei0eYz4+XP0sdH2RgDc9B4E=', 'Jomar Velasco', 'jo');

insert into schedule_settings (id, date, schedule_type, late_threshold) values
(1, '2026-04-01', 'A', '08:00'),
(2, '2026-04-02', 'A', '08:00'),
(3, '2026-04-03', 'A', '08:00'),
(4, '2026-04-04', 'A', '08:00'),
(5, '2026-04-05', 'A', '08:00'),
(6, '2026-04-06', 'A', '08:00'),
(7, '2026-04-07', 'A', '08:00'),
(8, '2026-04-08', 'A', '08:00'),
(9, '2026-04-09', 'B', '08:30'),
(10, '2026-04-10', 'B', '09:00');

insert into attendance (
  id,
  employee_id,
  date,
  time_in,
  time_out,
  late_minutes,
  undertime_minutes,
  overtime_minutes,
  leave_type,
  schedule_type
) values
(1, 1, '2026-04-01', '08:00', '17:10', 0, 0, 10, null, 'A'),
(2, 2, '2026-04-01', '08:12', '17:00', 11, 0, 0, null, 'A'),
(3, 3, '2026-04-01', '08:05', '16:45', 4, 15, 0, null, 'A'),
(4, 4, '2026-04-01', 'SL', 'SL', 0, 0, 0, 'SL', 'A'),
(5, 5, '2026-04-01', '08:01', '17:58', 0, 0, 58, null, 'A'),
(6, 7, '2026-04-01', '08:20', '19:03', 19, 0, 3, null, 'B'),
(7, 8, '2026-04-01', '07:55', '19:00', 0, 0, 0, null, 'B'),
(8, 9, '2026-04-01', 'OB', 'OB', 0, 0, 0, 'OB', 'B'),
(9, 10, '2026-04-01', '08:40', '18:10', 39, 50, 0, null, 'B'),
(10, 1, '2026-04-02', '08:10', '17:00', 9, 0, 0, null, 'A'),
(11, 2, '2026-04-02', 'VL', 'VL', 0, 0, 0, 'VL', 'A'),
(12, 3, '2026-04-02', '08:00', '17:30', 0, 0, 30, null, 'A'),
(13, 6, '2026-04-02', '08:25', '16:55', 24, 5, 0, null, 'A'),
(14, 7, '2026-04-02', '08:32', '19:20', 31, 0, 20, null, 'B'),
(15, 8, '2026-04-02', '08:14', '18:20', 13, 40, 0, null, 'B'),
(16, 9, '2026-04-02', '08:00', '18:58', 0, 2, 0, null, 'B'),
(17, 10, '2026-04-02', '08:03', '19:35', 2, 0, 35, null, 'B'),
(18, 4, '2026-04-03', '09:05', '17:00', 4, 0, 0, null, 'A'),
(19, 5, '2026-04-03', '08:45', '17:00', 0, 0, 0, null, 'A'),
(20, 6, '2026-04-03', '08:00', '17:05', 0, 0, 5, null, 'A');

insert into notifications (id, message, audience, created_at) values
(1, 'Alicia Ramos completed Time Out for 2026-04-01.', 'admin', '2026-04-01 17:10:00+08'),
(2, 'Brandon Cruz clocked in late at 08:12.', 'admin', '2026-04-01 08:12:00+08'),
(3, 'Daryl Mendoza filed SL for 2026-04-01.', 'all', '2026-04-01 07:55:00+08'),
(4, 'Grace Lim started Schedule B shift.', 'all', '2026-04-01 08:20:00+08'),
(5, 'JO attendance sheet updated by admin.', 'all', '2026-04-02 10:15:00+08'),
(6, 'Late threshold override set to 09:00 for 2026-04-10.', 'admin', '2026-04-09 16:35:00+08'),
(7, 'Manual backup created by admin.', 'admin', '2026-04-10 17:30:00+08'),
(8, 'Monthly report export completed for April 2026.', 'admin', '2026-04-10 17:45:00+08');

insert into backup_logs (id, filename, source, created_at) values
(1, 'dtr-backup-20260401-180001.json', 'automatic', '2026-04-01 18:00:01+08'),
(2, 'dtr-backup-20260402-180001.json', 'automatic', '2026-04-02 18:00:01+08'),
(3, 'dtr-backup-20260403-180001.json', 'automatic', '2026-04-03 18:00:01+08'),
(4, 'dtr-backup-20260409-173001.json', 'manual', '2026-04-09 17:30:01+08'),
(5, 'dtr-backup-20260410-173001.json', 'manual', '2026-04-10 17:30:01+08');

select setval('employees_id_seq', (select max(id) from employees));
select setval('schedule_settings_id_seq', (select max(id) from schedule_settings));
select setval('attendance_id_seq', (select max(id) from attendance));
select setval('notifications_id_seq', (select max(id) from notifications));
select setval('backup_logs_id_seq', (select max(id) from backup_logs));
