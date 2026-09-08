const ESC = "\u001b";

const COLORS = {
  reset: `${ESC}[0m`,
  dim: `${ESC}[2m`,
  red: `${ESC}[31m`,
  yellow: `${ESC}[33m`,
  cyan: `${ESC}[36m`,
  green: `${ESC}[32m`,
};

function stamp(): string {
  return `${COLORS.dim}${new Date().toISOString().slice(11, 23)}${COLORS.reset}`;
}

export const log = {
  info: (msg: string, ...rest: unknown[]) =>
    console.log(`${stamp()} ${COLORS.cyan}info${COLORS.reset}  ${msg}`, ...rest),
  ok: (msg: string, ...rest: unknown[]) =>
    console.log(`${stamp()} ${COLORS.green}ok${COLORS.reset}    ${msg}`, ...rest),
  warn: (msg: string, ...rest: unknown[]) =>
    console.warn(`${stamp()} ${COLORS.yellow}warn${COLORS.reset}  ${msg}`, ...rest),
  error: (msg: string, ...rest: unknown[]) =>
    console.error(`${stamp()} ${COLORS.red}error${COLORS.reset} ${msg}`, ...rest),
};
