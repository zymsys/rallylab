-- RallyLab initial schema
-- See specs/05-pre-race-data.md for full documentation.

-- ─── Domain Events ────────────────────────────────────────────────

CREATE TABLE domain_events (
  id BIGSERIAL PRIMARY KEY,
  rally_id UUID NOT NULL,
  section_id UUID,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  client_event_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dedup index for race day sync
CREATE UNIQUE INDEX idx_race_day_dedup
  ON domain_events(rally_id, section_id, client_event_id)
  WHERE client_event_id IS NOT NULL;

-- Lookup index for replaying events
CREATE INDEX idx_domain_events_lookup
  ON domain_events(rally_id, section_id);

-- ─── Rally Roles (RLS anchor, trigger-populated) ──────────────────

CREATE TABLE rally_roles (
  rally_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  role TEXT NOT NULL CHECK (role IN ('organizer', 'operator', 'registrar', 'checkin_volunteer')),
  section_id UUID,
  PRIMARY KEY (rally_id, user_id, role)
);

-- ─── Row-Level Security ───────────────────────────────────────────

ALTER TABLE domain_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read own events"
  ON domain_events FOR SELECT
  USING (
    rally_id IN (SELECT rally_id FROM rally_roles WHERE user_id = auth.uid())
  );

CREATE POLICY "Append own events"
  ON domain_events FOR INSERT
  WITH CHECK (
    (event_type = 'RallyCreated' AND auth.uid() IS NOT NULL)
    OR
    (rally_id IN (SELECT rally_id FROM rally_roles WHERE user_id = auth.uid()))
  );

ALTER TABLE rally_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read own roles"
  ON rally_roles FOR SELECT
  USING (user_id = auth.uid());

-- ─── Trigger 1: Grant organizer role on RallyCreated ──────────────

CREATE OR REPLACE FUNCTION on_rally_created()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.event_type = 'RallyCreated' THEN
    INSERT INTO rally_roles (rally_id, user_id, role)
    VALUES (NEW.rally_id, NEW.created_by, 'organizer')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_rally_created
  AFTER INSERT ON domain_events
  FOR EACH ROW
  WHEN (NEW.event_type = 'RallyCreated')
  EXECUTE FUNCTION on_rally_created();

-- ─── Trigger 2: Grant registrar role on RegistrarInvited ──────────

CREATE OR REPLACE FUNCTION on_registrar_invited()
RETURNS TRIGGER AS $$
DECLARE
  registrar_user_id UUID;
BEGIN
  IF NEW.event_type = 'RegistrarInvited' THEN
    SELECT id INTO registrar_user_id
    FROM auth.users
    WHERE email = NEW.payload->>'registrar_email';

    IF registrar_user_id IS NOT NULL THEN
      INSERT INTO rally_roles (rally_id, user_id, role, section_id)
      VALUES (NEW.rally_id, registrar_user_id, 'registrar', NEW.section_id)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_registrar_invited
  AFTER INSERT ON domain_events
  FOR EACH ROW
  WHEN (NEW.event_type = 'RegistrarInvited')
  EXECUTE FUNCTION on_registrar_invited();

-- ─── Trigger 3: Grant operator role on OperatorInvited ────────────

CREATE OR REPLACE FUNCTION on_operator_invited()
RETURNS TRIGGER AS $$
DECLARE
  operator_user_id UUID;
BEGIN
  IF NEW.event_type = 'OperatorInvited' THEN
    SELECT id INTO operator_user_id
    FROM auth.users
    WHERE email = NEW.payload->>'operator_email';

    IF operator_user_id IS NOT NULL THEN
      INSERT INTO rally_roles (rally_id, user_id, role)
      VALUES (NEW.rally_id, operator_user_id, 'operator')
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_operator_invited
  AFTER INSERT ON domain_events
  FOR EACH ROW
  WHEN (NEW.event_type = 'OperatorInvited')
  EXECUTE FUNCTION on_operator_invited();

-- ─── Trigger 4: Backfill roles when invited user signs up ─────────

CREATE OR REPLACE FUNCTION on_auth_user_created()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO rally_roles (rally_id, user_id, role, section_id)
  SELECT
    de.rally_id,
    NEW.id,
    'registrar',
    de.section_id
  FROM domain_events de
  WHERE de.event_type = 'RegistrarInvited'
    AND de.payload->>'registrar_email' = NEW.email
  ON CONFLICT DO NOTHING;

  INSERT INTO rally_roles (rally_id, user_id, role)
  SELECT
    de.rally_id,
    NEW.id,
    'operator'
  FROM domain_events de
  WHERE de.event_type = 'OperatorInvited'
    AND de.payload->>'operator_email' = NEW.email
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION on_auth_user_created();
