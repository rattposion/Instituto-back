export interface User {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: 'admin' | 'manager' | 'viewer';
  avatar?: string;
  workspace_id: string;
  is_active: boolean;
  last_login?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  description?: string;
  owner_id: string;
  settings: Record<string, any>;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: 'admin' | 'manager' | 'viewer';
  invited_by: string;
  joined_at?: Date;
  created_at: Date;
}

export interface Pixel {
  id: string;
  name: string;
  pixel_id: string;
  meta_account: string;
  workspace_id: string;
  status: 'active' | 'inactive' | 'error';
  last_activity?: Date;
  events_count: number;
  conversions_count: number;
  revenue: number;
  settings: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface Event {
  id: string;
  pixel_id: string;
  event_name: string;
  event_type: 'standard' | 'custom';
  parameters: Record<string, any>;
  source: 'web' | 'server' | 'mobile';
  user_agent?: string;
  ip_address?: string;
  timestamp: Date;
  processed: boolean;
  error_message?: string;
  created_at: Date;
}

export interface Conversion {
  id: string;
  name: string;
  pixel_id: string;
  event_name: string;
  rules: ConversionRule[];
  conversion_rate: number;
  total_conversions: number;
  total_value: number;
  average_value: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ConversionRule {
  type: 'url' | 'event' | 'parameter';
  operator: 'equals' | 'contains' | 'starts_with' | 'ends_with' | 'greater_than' | 'less_than';
  field: string;
  value: string | number;
}

export interface Diagnostic {
  id: string;
  pixel_id: string;
  severity: 'error' | 'warning' | 'info' | 'success';
  category: 'implementation' | 'events' | 'performance' | 'connection';
  title: string;
  description: string;
  url?: string;
  status: 'active' | 'resolved';
  last_checked: Date;
  created_at: Date;
}

export interface Integration {
  id: string;
  workspace_id: string;
  type: 'gtm' | 'wordpress' | 'shopify' | 'webhook';
  name: string;
  description: string;
  config: Record<string, any>;
  status: 'active' | 'inactive' | 'error';
  last_sync?: Date;
  pixels_connected: number;
  created_at: Date;
  updated_at: Date;
}

export interface ApiKey {
  id: string;
  workspace_id: string;
  name: string;
  key_hash: string;
  permissions: string[];
  last_used?: Date;
  expires_at?: Date;
  is_active: boolean;
  created_at: Date;
}

export interface AuditLog {
  id: string;
  workspace_id: string;
  user_id?: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  details: Record<string, any>;
  ip_address?: string;
  user_agent?: string;
  created_at: Date;
}

export interface JWTPayload {
  userId: string;
  workspaceId: string;
  role: string;
  iat: number;
  exp: number;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}