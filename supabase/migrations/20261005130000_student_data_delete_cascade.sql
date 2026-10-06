-- Student deletion is an intentional, permanent removal of the student's
-- school-owned records. Cascade through tables that reference those records.
DO $migration$
DECLARE
  v_fk record;
  v_definition text;
BEGIN
  FOR v_fk IN
    WITH RECURSIVE student_tree(relid) AS (
      SELECT 'public.students'::regclass
      UNION
      SELECT constraint_row.conrelid
      FROM pg_catalog.pg_constraint AS constraint_row
      JOIN student_tree AS parent_row
        ON constraint_row.confrelid = parent_row.relid
      WHERE constraint_row.contype = 'f'
        AND constraint_row.conrelid <> parent_row.relid
    )
    SELECT constraint_row.oid,
           constraint_row.conrelid,
           constraint_row.conname,
           constraint_row.confdeltype,
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true) AS definition
    FROM pg_catalog.pg_constraint AS constraint_row
    JOIN student_tree AS child_row ON child_row.relid = constraint_row.conrelid
    JOIN student_tree AS parent_row ON parent_row.relid = constraint_row.confrelid
    WHERE constraint_row.contype = 'f'
      AND constraint_row.conrelid <> 'public.students'::regclass
      AND constraint_row.confdeltype <> 'c'
  LOOP
    v_definition := v_fk.definition;
    IF v_fk.confdeltype <> 'a' THEN
      v_definition := regexp_replace(
        v_definition,
        ' ON DELETE (NO ACTION|RESTRICT|SET NULL|SET DEFAULT)( \([^)]*\))?',
        ' ON DELETE CASCADE',
        'i'
      );
    ELSIF position(' ON UPDATE ' IN v_definition) > 0 THEN
      v_definition := replace(v_definition, ' ON UPDATE ', ' ON DELETE CASCADE ON UPDATE ');
    ELSIF position(' DEFERRABLE' IN v_definition) > 0 THEN
      v_definition := replace(v_definition, ' DEFERRABLE', ' ON DELETE CASCADE DEFERRABLE');
    ELSE
      v_definition := v_definition || ' ON DELETE CASCADE';
    END IF;

    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', v_fk.conrelid::regclass, v_fk.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', v_fk.conrelid::regclass, v_fk.conname, v_definition);
  END LOOP;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.delete_student_owned_rows_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_table record;
BEGIN
  FOR v_table IN
    SELECT namespace_row.nspname AS schema_name,
           table_row.relname AS table_name,
           EXISTS (
             SELECT 1
             FROM pg_catalog.pg_attribute AS school_column
             WHERE school_column.attrelid = table_row.oid
               AND school_column.attname = 'school_id'
               AND school_column.attnum > 0
               AND NOT school_column.attisdropped
           ) AS has_school_id
    FROM pg_catalog.pg_class AS table_row
    JOIN pg_catalog.pg_namespace AS namespace_row ON namespace_row.oid = table_row.relnamespace
    JOIN pg_catalog.pg_attribute AS student_column ON student_column.attrelid = table_row.oid
    WHERE namespace_row.nspname = 'public'
      AND table_row.relkind IN ('r', 'p')
      AND table_row.oid <> 'public.students'::regclass
      AND student_column.attname = 'student_id'
      AND student_column.attnum > 0
      AND NOT student_column.attisdropped
  LOOP
    IF v_table.has_school_id THEN
      EXECUTE format(
        'DELETE FROM %I.%I WHERE student_id = $1 AND school_id = $2',
        v_table.schema_name,
        v_table.table_name
      ) USING OLD.id, OLD.school_id;
    ELSE
      EXECUTE format(
        'DELETE FROM %I.%I WHERE student_id = $1',
        v_table.schema_name,
        v_table.table_name
      ) USING OLD.id;
    END IF;
  END LOOP;

  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS students_delete_owned_rows ON public.students;
CREATE TRIGGER students_delete_owned_rows
BEFORE DELETE ON public.students
FOR EACH ROW
EXECUTE FUNCTION public.delete_student_owned_rows_before_delete();
