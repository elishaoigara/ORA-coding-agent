export type SpecialistRole = "researcher" | "coder" | "debugger" | "tester" | "reviewer" | "security" | "devops";

export interface SpecialistDefinition {
  id: SpecialistRole;
  label: string;
  focus: string;
  deliverable: string;
}

export const SPECIALISTS: SpecialistDefinition[] = [
  { id: "researcher", label: "Researcher", focus: "framework, dependency, and repository evidence", deliverable: "relevant facts, constraints, and source locations" },
  { id: "coder", label: "Coder", focus: "small, coherent implementation changes", deliverable: "file-level implementation plan" },
  { id: "debugger", label: "Debugger", focus: "root cause, stack traces, logs, and failure paths", deliverable: "reproduction hypothesis and smallest fix" },
  { id: "tester", label: "Tester", focus: "acceptance criteria and regression coverage", deliverable: "verification commands and expected outcomes" },
  { id: "reviewer", label: "Reviewer", focus: "maintainability, scope, and change quality", deliverable: "review risks and approval conditions" },
  { id: "security", label: "Security", focus: "secrets, permissions, input validation, and vulnerabilities", deliverable: "security findings and required safeguards" },
  { id: "devops", label: "DevOps", focus: "build, deployment, runtime, and health checks", deliverable: "operational verification checklist" },
];

export function getSpecialists(ids: string[]): SpecialistDefinition[] {
  const allowed = new Set<string>(SPECIALISTS.map((role) => role.id));
  const valid = ids.filter((id): id is SpecialistRole => allowed.has(id));
  return valid.slice(0, 4).map((id) => SPECIALISTS.find((role) => role.id === id)!);
}

export function collaborationBrief(ids: string[]): string {
  const roles = getSpecialists(ids);
  if (roles.length === 0) return "";
  return `\n\nCOLLABORATION MODE (bounded specialist perspectives):\n${roles.map((role, index) => `${index + 1}. ${role.label}: focus on ${role.focus}; provide ${role.deliverable}.`).join("\n")}\nThe manager agent must reconcile these perspectives into one plan, cite repository evidence, avoid duplicate work, and stop at the existing approval boundary.`;
}
