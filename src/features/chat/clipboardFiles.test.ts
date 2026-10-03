import { describe, expect, it, vi } from 'vitest'
import { getClipboardFiles } from './clipboardFiles'

function clipboard(files: File[], items: Partial<DataTransferItem>[] = []): DataTransfer {
  return { files, items } as unknown as DataTransfer
}

describe('getClipboardFiles', () => {
  it('reads multiple files with their original names, types and contents', async () => {
    const files = [
      new File(['document'], 'notes.pdf', { type: 'application/pdf' }),
      new File(['image'], 'photo.png', { type: 'image/png' }),
    ]

    const result = getClipboardFiles(clipboard(files))

    expect(result).toEqual(files)
    expect(result[0]).toBe(files[0])
    expect(await result[0].text()).toBe('document')
    expect(result[1].name).toBe('photo.png')
    expect(result[1].type).toBe('image/png')
  })

  it('does not duplicate files exposed through both clipboard APIs', () => {
    const file = new File(['image'], 'image.png', { type: 'image/png' })
    const getAsFile = vi.fn(() => file)

    expect(getClipboardFiles(clipboard([file], [{ kind: 'file', getAsFile }]))).toEqual([file])
    expect(getAsFile).not.toHaveBeenCalled()
  })

  it('falls back to file items for pasted screenshots and skips unreadable items', () => {
    const screenshot = new File(['screenshot'], 'image.png', { type: 'image/png' })
    const data = clipboard([], [
      { kind: 'string', getAsFile: () => null },
      { kind: 'file', getAsFile: () => null },
      { kind: 'file', getAsFile: () => screenshot },
    ])

    expect(getClipboardFiles(data)).toEqual([screenshot])
  })

  it('leaves plain text, HTML and URLs to native text paste', () => {
    const getAsFile = vi.fn(() => null)
    const data = clipboard([], ['text/plain', 'text/html', 'text/uri-list'].map((type) => ({
      kind: 'string', type, getAsFile,
    })))

    expect(getClipboardFiles(data)).toEqual([])
    expect(getAsFile).not.toHaveBeenCalled()
    expect(getClipboardFiles(clipboard([]))).toEqual([])
  })

  it('passes empty and blocked files to the shared attachment validation', () => {
    const files = [
      new File([], 'empty.txt'),
      new File(['executable'], 'script.sh', { type: 'application/x-sh' }),
    ]

    expect(getClipboardFiles(clipboard(files))).toEqual(files)
  })
})
