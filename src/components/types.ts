export type Opt = { value: string; label: string };
export interface FieldDef {
  name: string; label: string; type?: 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'textarea' | 'email';
  required?: boolean; options?: Opt[]; default?: string | number | boolean;
  optionsFrom?: { table: string; value: string; label: string; order?: string; eq?: Record<string, string | boolean> };
  readOnlyOnEdit?: boolean;
}
export interface ColDef { key: string; label: string; format?: 'money' | 'number' | 'date' | 'pill' | 'bool' | 'text' }
export interface ActionDef {
  label: string; rpc?: string; args?: Record<string, string>; href?: string; prompts?: FieldDef[]; confirm?: string;
  when?: { field: string; in: string[] }; variant?: 'alt' | 'danger' | 'gold';
}
export interface ResourceConfig {
  title: string; table: string; select?: string; order?: string; ascending?: boolean; columns: ColDef[]; fields?: FieldDef[];
  actions?: ActionDef[]; editable?: boolean; description?: string; createLabel?: string; empty?: string; limit?: number; noCreate?: boolean; filter?: Record<string, string>; createRpc?: string;
}
