interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * US EPA Envirofacts MCP.
 *
 * Keyless access to EPA's Facility Registry Service (FRS) via the Envirofacts
 * REST data service. Look up EPA-regulated facilities by ZIP, state/city, or
 * Registry ID, and see every EPA program (RCRAINFO, NPDES, AIRS, TRI, etc.)
 * a given site is regulated under.
 *
 * REST model is path-based:
 *   {BASE}/{TABLE}/{COLUMN}/{VALUE}/.../ROWS/{start}:{end}/JSON
 * Equality filter is `/{COLUMN}/{VALUE}/`. Always append `/JSON`.
 *
 * NOTE: Envirofacts row ranges are INCLUSIVE — `ROWS/0:19` returns 20 rows.
 *
 * Verified live against FRS_PROGRAM_FACILITY (2026-06): columns are lowercase
 * (registry_id, primary_name, pgm_sys_acrnm, pgm_sys_id, location_address,
 * city_name, state_code, postal_code, county_name). This table carries one row
 * PER PROGRAM a facility is enrolled in, so the same registry_id repeats — we
 * de-dupe and collapse the programs into a programs[] array. The table has NO
 * latitude/longitude columns, so those surface as null.
 */


const BASE = 'https://data.epa.gov/efservice';
const UA = 'pipeworx/1.0 (+https://pipeworx.io)';

type Row = Record<string, unknown>;

const tools: McpToolExport['tools'] = [
  {
    name: 'facilities_by_zip',
    description:
      "List EPA-regulated facilities in a US ZIP code from the EPA Facility Registry Service (FRS). Returns each facility once with all the EPA programs (RCRAINFO, NPDES, AIRS, TRI, etc.) it's regulated under. Keyless.",
    inputSchema: {
      type: 'object',
      properties: {
        zip: { type: 'string', description: '5-digit US ZIP code, e.g. "94704".' },
        limit: { type: 'number', description: 'Max rows to fetch (default 20, max 50).' },
      },
      required: ['zip'],
    },
  },
  {
    name: 'facilities_by_state',
    description:
      'List EPA-regulated facilities in a US state (and optionally a city) from the EPA Facility Registry Service (FRS). Returns each facility once with all the EPA programs it is regulated under. Keyless.',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', description: '2-letter US state code, e.g. "CA".' },
        city: { type: 'string', description: 'Optional city name, e.g. "Berkeley".' },
        limit: { type: 'number', description: 'Max rows to fetch (default 20, max 50).' },
      },
      required: ['state'],
    },
  },
  {
    name: 'get_facility',
    description:
      'Look up one EPA-regulated facility by its FRS Registry ID. Returns the facility detail plus a programs[] array listing every EPA program (RCRAINFO, NPDES, AIRS, TRI, etc.) the site is regulated under. Keyless.',
    inputSchema: {
      type: 'object',
      properties: {
        registry_id: { type: 'string', description: 'FRS Registry ID, e.g. "110066524112".' },
      },
      required: ['registry_id'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      case 'facilities_by_zip':
        return facilitiesByZip(args);
      case 'facilities_by_state':
        return facilitiesByState(args);
      case 'get_facility':
        return getFacility(args);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function clampLimit(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 20;
  return Math.max(1, Math.min(50, n));
}

/** Fetch an Envirofacts path and parse JSON, guarding against XML/error strings. */
async function fetchRows(path: string): Promise<Row[]> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Envirofacts: ${res.status} ${text.slice(0, 200)}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Envirofacts returned non-JSON (likely a bad column name): ${text.slice(0, 200)}`);
  }
  return Array.isArray(data) ? (data as Row[]) : [];
}

/** Map a raw FRS row to a normalized facility shape. */
function mapFacility(row: Row) {
  return {
    registry_id: row.registry_id ?? null,
    name: row.primary_name ?? null,
    address: row.location_address ?? null,
    city: row.city_name ?? null,
    state: row.state_code ?? null,
    zip: row.postal_code ?? null,
    county: row.county_name ?? null,
    // FRS_PROGRAM_FACILITY has no lat/long columns; surface null if absent.
    latitude: (row.latitude83 as unknown) ?? (row.latitude as unknown) ?? null,
    longitude: (row.longitude83 as unknown) ?? (row.longitude as unknown) ?? null,
  };
}

/**
 * Collapse FRS rows (one per program) into one facility per registry_id.
 * Keeps the first row's facility fields and gathers every program into
 * a programs[] array of { program, program_id }.
 */
function dedupeByRegistryId(rows: Row[]) {
  const byId = new Map<string, ReturnType<typeof mapFacility> & {
    programs: Array<{ program: unknown; program_id: unknown }>;
  }>();

  for (const row of rows) {
    const id = String(row.registry_id ?? '');
    if (!id) continue;
    let entry = byId.get(id);
    if (!entry) {
      entry = { ...mapFacility(row), programs: [] };
      byId.set(id, entry);
    }
    const program = row.pgm_sys_acrnm ?? null;
    const programId = row.pgm_sys_id ?? null;
    if (program != null || programId != null) {
      entry.programs.push({ program, program_id: programId });
    }
  }

  return Array.from(byId.values());
}

async function facilitiesByZip(args: Record<string, unknown>): Promise<unknown> {
  const zip = typeof args.zip === 'string' ? args.zip.trim() : '';
  if (!/^\d{5}$/.test(zip)) return { error: 'provide a 5-digit ZIP code', zip: args.zip ?? null };
  const limit = clampLimit(args.limit);

  const rows = await fetchRows(
    `/FRS_PROGRAM_FACILITY/POSTAL_CODE/${zip}/ROWS/0:${limit - 1}/JSON`,
  );
  const facilities = dedupeByRegistryId(rows);
  return { count: facilities.length, facilities };
}

async function facilitiesByState(args: Record<string, unknown>): Promise<unknown> {
  const state = typeof args.state === 'string' ? args.state.trim().toUpperCase() : '';
  if (!/^[A-Z]{2}$/.test(state)) return { error: 'provide a 2-letter state code', state: args.state ?? null };
  const city = typeof args.city === 'string' ? args.city.trim() : '';
  const limit = clampLimit(args.limit);

  // encodeURIComponent already maps spaces -> %20, which is what Envirofacts wants.
  const citySeg = city ? `/CITY_NAME/${encodeURIComponent(city)}` : '';
  const rows = await fetchRows(
    `/FRS_PROGRAM_FACILITY/STATE_CODE/${state}${citySeg}/ROWS/0:${limit - 1}/JSON`,
  );
  const facilities = dedupeByRegistryId(rows);
  return { count: facilities.length, facilities };
}

async function getFacility(args: Record<string, unknown>): Promise<unknown> {
  const id = typeof args.registry_id === 'string' ? args.registry_id.trim() : '';
  if (!id) return { error: 'provide a registry_id', registry_id: args.registry_id ?? null };

  const rows = await fetchRows(`/FRS_PROGRAM_FACILITY/REGISTRY_ID/${encodeURIComponent(id)}/JSON`);
  const facilities = dedupeByRegistryId(rows);
  if (facilities.length === 0) return { error: 'facility not found', registry_id: id };
  return facilities[0];
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
