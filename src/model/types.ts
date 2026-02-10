export type CardDensity = 'normal' | 'compact';

export interface ColumnDefinition {
  id: string;
  title: string;
  wipLimit: number | null;
}

export interface Card {
  id: string;
  title: string;
  description: string;
  checked: boolean;
  dueDate: string | null;
  tags: string[];
  searchText: string;
}

export interface Column {
  id: string;
  title: string;
  wipLimit: number | null;
  cards: Card[];
}

export interface BoardDocument {
  boardTitle: string;
  boardDescription: string;
  density: CardDensity;
  columns: Column[];
  archive: Card[];
}

export interface BoardFrontmatter {
  kanban: true;
  kanbanVersion: number;
  boardTitle: string;
  boardDescription?: string;
  density: CardDensity;
  columns: ColumnDefinition[];
}

export interface BoardFilter {
  query: string;
  tag: string;
}

export interface BoardStoreSnapshot {
  board: BoardDocument;
  filter: BoardFilter;
  visibleColumns: Column[];
  allTags: string[];
}
