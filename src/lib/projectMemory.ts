export interface ProjectMemory {
  version: 1;
  repo: string;
  architecture: string;
  conventions: string;
  stack: string;
  database: string;
  deployment: string;
  decisions: string[];
  knownBugs: string[];
  todos: string[];
  updatedAt: number;
}

export const EMPTY_PROJECT_MEMORY: Omit<ProjectMemory, "repo" | "updatedAt"> = {
  version: 1,
  architecture: "",
  conventions: "",
  stack: "",
  database: "",
  deployment: "",
  decisions: [],
  knownBugs: [],
  todos: [],
};

const MAX_TEXT = 8_000;
const MAX_LIST_ITEMS = 40;
const MAX_LIST_ITEM = 500;

function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_TEXT) : "";
}
function trimList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, MAX_LIST_ITEM)).filter(Boolean).slice(0, MAX_LIST_ITEMS);
}

export function createProjectMemory(repo: string, raw?: Partial<ProjectMemory>): ProjectMemory {
  return {
    version: 1,
    repo,
    architecture: trimText(raw?.architecture),
    conventions: trimText(raw?.conventions),
    stack: trimText(raw?.stack),
    database: trimText(raw?.database),
    deployment: trimText(raw?.deployment),
    decisions: trimList(raw?.decisions),
    knownBugs: trimList(raw?.knownBugs),
    todos: trimList(raw?.todos),
    updatedAt: Date.now(),
  };
}

export function memoryStorageKey(repo: string): string {
  return `ora:project-memory:${repo.toLowerCase()}`;
}

export function loadProjectMemory(repo: string): ProjectMemory {
  if (typeof window === "undefined") return createProjectMemory(repo);
  try {
    const raw = JSON.parse(window.localStorage.getItem(memoryStorageKey(repo)) || "null") as Partial<ProjectMemory> | null;
    return createProjectMemory(repo, raw ?? undefined);
  } catch {
    return createProjectMemory(repo);
  }
}

export function saveProjectMemory(memory: ProjectMemory): ProjectMemory {
  const normalized = createProjectMemory(memory.repo, memory);
  if (typeof window !== "undefined") window.localStorage.setItem(memoryStorageKey(normalized.repo), JSON.stringify(normalized));
  return normalized;
}

export function memoryPromptContext(memory: ProjectMemory): string {
  const sections = [
    ["Architecture", memory.architecture],
    ["Stack", memory.stack],
    ["Conventions", memory.conventions],
    ["Database", memory.database],
    ["Deployment", memory.deployment],
    ["Important decisions", memory.decisions.map((item) => `- ${item}`).join("\n")],
    ["Known bugs", memory.knownBugs.map((item) => `- ${item}`).join("\n")],
    ["TODOs", memory.todos.map((item) => `- ${item}`).join("\n")],
  ].filter(([, value]) => value.trim());
  return sections.length === 0 ? "" : `\n\nPROJECT MEMORY (user-maintained context; verify against the repository):\n${sections.map(([label, value]) => `${label}:\n${value}`).join("\n\n")}`;
}
