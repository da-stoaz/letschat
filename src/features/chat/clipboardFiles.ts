export function getClipboardFiles(clipboardData: DataTransfer): File[] {
  // Read synchronously during paste; browsers restrict access after the event.
  const files = Array.from(clipboardData.files)
  if (files.length > 0) return files

  // Some clipboard sources expose images only as file items. Use a fallback
  // instead of merging both lists, which would attach the same file twice.
  return Array.from(clipboardData.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
}
