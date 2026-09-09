/** Tool configurations contain multiple lines; only a separator starts another tool. */
export function customToolNotes(value: string | undefined): string[] {
  return (value ?? "")
    .split(/\r?\n[\t ]*---[\t ]*\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
