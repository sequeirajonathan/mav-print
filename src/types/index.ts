import { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

export interface PrintCommand {
  type: 'PRINT';
  orderId: string;
  labelUrl: string;
  printerName?: string;
  settings?: {
    printerName?: string;
    labelUrl?: string;
    silent?: boolean;
  };
}

export type PrintResponse = {
  success: boolean;
  message: string;
  error?: string;
};

export interface PrintJob {
  id: string;
  order_id: string;
  label_url: string;
  status: string;
  claimed_by: string | null;
  claimed_at: string | null;
  printed_at: string | null;
  retries: number;
  last_tried_at: string | null;
  created_at: string;
  updated_at: string;
  printer_name?: string | null;
  copies?: number | null;
  paper_size?: string | null;
  orientation?: string | null;
}

export type PrintJobUpdate = RealtimePostgresChangesPayload<PrintJob>; 