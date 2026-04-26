-- Rollback for build64: drop the trigger. Function is left intact (it was
-- already present pre-build64 and is referenced from migrations 14d/48).
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
