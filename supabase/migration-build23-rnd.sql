-- Build 2.3: R&D Department — read-only query function for R&D agent

-- Function to execute read-only SQL queries from the R&D agent
create or replace function execute_readonly_query(query_text text)
returns json
language plpgsql
security definer
as $$
declare
  result json;
begin
  -- Only allow SELECT queries
  if not (lower(trim(query_text)) like 'select%') then
    raise exception 'Only SELECT queries are allowed';
  end if;

  -- Block dangerous keywords
  if lower(query_text) ~ '(drop|delete|update|insert|alter|truncate|create|grant|revoke)' then
    raise exception 'Query contains forbidden keywords';
  end if;

  -- Execute with 100 row limit and return as JSON
  execute 'select json_agg(row_to_json(t)) from (' || query_text || ' limit 100) t' into result;
  return coalesce(result, '[]'::json);
end;
$$;
