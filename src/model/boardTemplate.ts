import { BoardDocument } from './types';

export function createDefaultBoard(boardTitle: string): BoardDocument {
  return {
    boardTitle,
    boardDescription: '',
    density: 'normal',
    columns: [],
    archive: [],
  };
}
