# School Database Design

This database stores students, the courses they can take, and which students are enrolled on which courses.

## Tables

### students
- Holds one row per student.
- `student_id` is the primary key.
- `name` and `email` are required (`NOT NULL`).
- `email` is `UNIQUE`, so two students cannot share the same email address.

### courses
- Holds one row per course.
- `course_id` is the primary key.
- `title` and `credits` are required.

### enrolments
- Holds one row per enrolment, meaning one student on one course.
- `enrolment_id` is the primary key.
- `student_id` is a foreign key to `students`, and `course_id` is a foreign key to `courses`.
- `grade` holds the student's result for that course. It can be empty (`NULL`) until the student has been graded.
- `UNIQUE (student_id, course_id)` stops the same student enrolling on the same course twice.

## Relationships

- **students to enrolments: one-to-many.** One student can have many enrolments, but each enrolment belongs to exactly one student.
- **courses to enrolments: one-to-many.** One course can have many enrolments, but each enrolment belongs to exactly one course.
- **students to courses: many-to-many.** A student can take many courses, and a course can have many students.

A join table (`enrolments`) is needed because a relational table cannot store a list of values in one column. Putting course ids inside the `students` table (or student ids inside `courses`) would mean repeated or multi-valued columns, which are hard to search and easy to get wrong. The join table turns one many-to-many relationship into two one-to-many relationships. It is also the natural place for the `grade`, because a grade belongs to the pair of one student and one course, not to either of them alone.

## Index

I would add an index on `enrolments (course_id)`:

```sql
CREATE INDEX idx_enrolments_course_id ON enrolments (course_id);
```

The `UNIQUE (student_id, course_id)` rule already creates an index that makes searching by student fast. Searching by course alone (for example "all students on Databases" or counting students per course) cannot use that index efficiently, so a separate index on `course_id` keeps those queries fast as the number of enrolments grows.

## SQL or NoSQL?

I would choose SQL (a relational database such as SQLite, PostgreSQL or MySQL) for this system. The data is highly structured and connected: students, courses and enrolments all refer to each other, and the rules matter (every enrolment must point to a real student and a real course, emails must be unique, and nobody can enrol twice). A relational database enforces these rules itself with primary keys, foreign keys and constraints, and it makes questions such as "how many students are on each course?" or "which students have no enrolments?" easy to answer with joins and `GROUP BY`. A NoSQL database such as a document store would be a better fit if the data had no fixed shape, changed structure often, or had to be spread across many servers at very large scale, but a school's records need consistency more than flexibility.
