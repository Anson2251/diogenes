declare module "cli-table3" {
    interface TableStyle {
        head?: string[];
        border?: string[];
    }

    interface TableOptions {
        head?: string[];
        style?: TableStyle;
        wordWrap?: boolean;
    }

    type TableRow = Array<string | number>;

    export default class Table {
        constructor(options?: TableOptions);
        push(...rows: TableRow[]): number;
        toString(): string;
    }
}
