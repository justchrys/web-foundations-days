-- School database: students, courses and enrolments
-- Works in SQLite (for example on sqliteonline.com)

PRAGMA foreign_keys = ON;

-- ---------- 1. Tables ----------

CREATE TABLE students (
  student_id INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE
);

CREATE TABLE courses (
  course_id INTEGER PRIMARY KEY,
  title     TEXT NOT NULL,
  credits   INTEGER NOT NULL
);

-- Join table: one row = one student enrolled on one course
CREATE TABLE enrolments (
  enrolment_id INTEGER PRIMARY KEY,
  student_id   INTEGER NOT NULL,
  course_id    INTEGER NOT NULL,
  grade        INTEGER CHECK (grade BETWEEN 0 AND 100),  -- NULL until graded
  FOREIGN KEY (student_id) REFERENCES students (student_id),
  FOREIGN KEY (course_id)  REFERENCES courses (course_id),
  UNIQUE (student_id, course_id)  -- the same student cannot enrol on the same course twice
);

-- Index to speed up "all students on one course" lookups
CREATE INDEX idx_enrolments_course_id ON enrolments (course_id);

-- ---------- 2. Sample data ----------

INSERT INTO students (name, email) VALUES
  ('Amina Yusuf',  'amina.yusuf@example.com'),
  ('Brian Otieno', 'brian.otieno@example.com'),
  ('Chloe Martin', 'chloe.martin@example.com'),
  ('David Kimani', 'david.kimani@example.com');

INSERT INTO courses (title, credits) VALUES
  ('Web Development',    4),
  ('Databases',          3),
  ('Python Programming', 4);

INSERT INTO enrolments (student_id, course_id, grade) VALUES
  (1, 1, 78),
  (1, 2, 85),
  (2, 1, 64),
  (2, 3, NULL),
  (3, 2, 91),
  (3, 3, 72);
-- David (student 4) has no enrolments on purpose, for query 4.

-- ---------- 3. Queries ----------
-- Tip: some playgrounds only show the result of the last statement,
-- so highlight and run one query at a time.

-- Query 1: all courses for one student (by name)
SELECT courses.title, courses.credits, enrolments.grade
FROM students
JOIN enrolments ON enrolments.student_id = students.student_id
JOIN courses    ON courses.course_id = enrolments.course_id
WHERE students.name = 'Amina Yusuf';

-- Query 2: all students on one course
SELECT students.name, students.email, enrolments.grade
FROM courses
JOIN enrolments ON enrolments.course_id = courses.course_id
JOIN students   ON students.student_id = enrolments.student_id
WHERE courses.title = 'Databases';

-- Query 3: number of students per course
-- (LEFT JOIN so a course with no students would still show 0)
SELECT courses.title, COUNT(enrolments.enrolment_id) AS number_of_students
FROM courses
LEFT JOIN enrolments ON enrolments.course_id = courses.course_id
GROUP BY courses.course_id, courses.title;

-- Query 4: students who have no enrolments
SELECT students.name, students.email
FROM students
LEFT JOIN enrolments ON enrolments.student_id = students.student_id
WHERE enrolments.enrolment_id IS NULL;

-- Query 5: update one enrolment's grade (Brian's grade for Python Programming)
UPDATE enrolments
SET grade = 80
WHERE student_id = (SELECT student_id FROM students WHERE name = 'Brian Otieno')
  AND course_id  = (SELECT course_id FROM courses WHERE title = 'Python Programming');

-- Check the update
SELECT students.name, courses.title, enrolments.grade
FROM enrolments
JOIN students ON students.student_id = enrolments.student_id
JOIN courses  ON courses.course_id = enrolments.course_id
WHERE students.name = 'Brian Otieno';
