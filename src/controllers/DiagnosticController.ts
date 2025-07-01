import { Response } from 'express';
import { supabase } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class DiagnosticController {
  async getDiagnostics(req: AuthRequest, res: Response) {
    const { 
      page = 1, 
      limit = 20, 
      search, 
      pixelId, 
      severity, 
      category, 
      status,
      sortBy = 'created_at', 
      sortOrder = 'desc' 
    } = req.query;
    
    const offset = (Number(page) - 1) * Number(limit);

    let query = supabase
      .from('diagnostics')
      .select(`
        *,
        pixels!inner(id, name, workspace_id)
      `, { count: 'exact' })
      .eq('pixels.workspace_id', req.user!.workspaceId)
      .range(offset, offset + Number(limit) - 1)
      .order(sortBy as string, { ascending: sortOrder === 'asc' });

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    if (pixelId) {
      query = query.eq('pixel_id', pixelId);
    }

    if (severity) {
      query = query.eq('severity', severity);
    }

    if (category) {
      query = query.eq('category', category);
    }

    if (status) {
      query = query.eq('status', status);
    }

    const { data: diagnostics, error, count } = await query;

    if (error) {
      logger.error('Error fetching diagnostics:', error);
      throw createError('Failed to fetch diagnostics', 500);
    }

    res.json({
      success: true,
      data: diagnostics,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / Number(limit))
      }
    });
  }

  async getDiagnosticById(req: AuthRequest, res: Response) {
    const { id } = req.params;

    const { data: diagnostic, error } = await supabase
      .from('diagnostics')
      .select(`
        *,
        pixels!inner(id, name, workspace_id)
      `)
      .eq('id', id)
      .eq('pixels.workspace_id', req.user!.workspaceId)
      .single();

    if (error || !diagnostic) {
      throw createError('Diagnostic not found', 404);
    }

    res.json({
      success: true,
      data: diagnostic
    });
  }

  async runDiagnostics(req: AuthRequest, res: Response) {
    const { pixelId } = req.params;

    // Verify pixel belongs to workspace
    const { data: pixel, error: pixelError } = await supabase
      .from('pixels')
      .select('*')
      .eq('id', pixelId)
      .eq('workspace_id', req.user!.workspaceId)
      .single();

    if (pixelError || !pixel) {
      throw createError('Pixel not found', 404);
    }

    // Run various diagnostic checks
    const diagnosticResults = await this.performDiagnosticChecks(pixel);

    // Save diagnostic results
    const savedDiagnostics = [];
    for (const result of diagnosticResults) {
      const { data: diagnostic, error } = await supabase
        .from('diagnostics')
        .upsert({
          pixel_id: pixelId,
          severity: result.severity,
          category: result.category,
          title: result.title,
          description: result.description,
          url: result.url,
          status: 'active',
          last_checked: new Date().toISOString()
        }, {
          onConflict: 'pixel_id,title'
        })
        .select()
        .single();

      if (!error && diagnostic) {
        savedDiagnostics.push(diagnostic);
      }
    }

    res.json({
      success: true,
      data: {
        pixelId,
        diagnosticsRun: diagnosticResults.length,
        issues: savedDiagnostics.length,
        results: savedDiagnostics
      }
    });
  }

  async resolveDiagnostic(req: AuthRequest, res: Response) {
    const { id } = req.params;

    // Check if diagnostic exists and belongs to workspace
    const { data: existingDiagnostic, error: fetchError } = await supabase
      .from('diagnostics')
      .select(`
        *,
        pixels!inner(workspace_id)
      `)
      .eq('id', id)
      .eq('pixels.workspace_id', req.user!.workspaceId)
      .single();

    if (fetchError || !existingDiagnostic) {
      throw createError('Diagnostic not found', 404);
    }

    const { data: diagnostic, error } = await supabase
      .from('diagnostics')
      .update({
        status: 'resolved',
        last_checked: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error('Error resolving diagnostic:', error);
      throw createError('Failed to resolve diagnostic', 500);
    }

    res.json({
      success: true,
      data: diagnostic
    });
  }

  async getDiagnosticsSummary(req: AuthRequest, res: Response) {
    const { data: diagnostics, error } = await supabase
      .from('diagnostics')
      .select(`
        severity, category, status,
        pixels!inner(workspace_id)
      `)
      .eq('pixels.workspace_id', req.user!.workspaceId);

    if (error) {
      logger.error('Error fetching diagnostics summary:', error);
      throw createError('Failed to fetch summary', 500);
    }

    const summary = {
      total: diagnostics?.length || 0,
      bySeverity: {
        error: 0,
        warning: 0,
        info: 0,
        success: 0
      },
      byCategory: {
        implementation: 0,
        events: 0,
        performance: 0,
        connection: 0
      },
      byStatus: {
        active: 0,
        resolved: 0
      }
    };

    diagnostics?.forEach(diagnostic => {
      summary.bySeverity[diagnostic.severity as keyof typeof summary.bySeverity]++;
      summary.byCategory[diagnostic.category as keyof typeof summary.byCategory]++;
      summary.byStatus[diagnostic.status as keyof typeof summary.byStatus]++;
    });

    res.json({
      success: true,
      data: summary
    });
  }

  async exportDiagnosticsReport(req: AuthRequest, res: Response) {
    const { format = 'json', pixelId, severity, status } = req.query;

    let query = supabase
      .from('diagnostics')
      .select(`
        *,
        pixels!inner(id, name, workspace_id)
      `)
      .eq('pixels.workspace_id', req.user!.workspaceId)
      .order('created_at', { ascending: false });

    if (pixelId) {
      query = query.eq('pixel_id', pixelId);
    }

    if (severity) {
      query = query.eq('severity', severity);
    }

    if (status) {
      query = query.eq('status', status);
    }

    const { data: diagnostics, error } = await query;

    if (error) {
      logger.error('Error exporting diagnostics:', error);
      throw createError('Failed to export diagnostics', 500);
    }

    if (format === 'csv') {
      const csv = this.convertToCSV(diagnostics || []);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=diagnostics-report.csv');
      res.send(csv);
    } else {
      res.json({
        success: true,
        data: {
          exportedAt: new Date().toISOString(),
          totalRecords: diagnostics?.length || 0,
          diagnostics
        }
      });
    }
  }

  private async performDiagnosticChecks(pixel: any): Promise<any[]> {
    const results = [];
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Check 1: Recent events
    const { data: recentEvents } = await supabase
      .from('events')
      .select('id')
      .eq('pixel_id', pixel.id)
      .gte('timestamp', oneHourAgo.toISOString())
      .limit(1);

    if (!recentEvents || recentEvents.length === 0) {
      results.push({
        severity: 'warning',
        category: 'performance',
        title: 'Low event volume',
        description: 'No events received in the last hour',
        url: null
      });
    }

    // Check 2: Error rate
    const { data: allEvents } = await supabase
      .from('events')
      .select('id, error_message')
      .eq('pixel_id', pixel.id)
      .gte('timestamp', oneDayAgo.toISOString());

    if (allEvents && allEvents.length > 0) {
      const errorEvents = allEvents.filter(e => e.error_message);
      const errorRate = (errorEvents.length / allEvents.length) * 100;

      if (errorRate > 10) {
        results.push({
          severity: 'error',
          category: 'events',
          title: 'High error rate',
          description: `${errorRate.toFixed(1)}% of events are failing`,
          url: null
        });
      } else if (errorRate > 5) {
        results.push({
          severity: 'warning',
          category: 'events',
          title: 'Elevated error rate',
          description: `${errorRate.toFixed(1)}% of events are failing`,
          url: null
        });
      }
    }

    // Check 3: Pixel status
    if (pixel.status === 'inactive') {
      results.push({
        severity: 'warning',
        category: 'implementation',
        title: 'Pixel inactive',
        description: 'Pixel is marked as inactive',
        url: null
      });
    } else if (pixel.status === 'error') {
      results.push({
        severity: 'error',
        category: 'implementation',
        title: 'Pixel error',
        description: 'Pixel is in error state',
        url: null
      });
    }

    // Check 4: Last activity
    if (pixel.last_activity) {
      const lastActivity = new Date(pixel.last_activity);
      const hoursSinceActivity = (now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60);

      if (hoursSinceActivity > 24) {
        results.push({
          severity: 'warning',
          category: 'performance',
          title: 'No recent activity',
          description: `Last activity was ${Math.floor(hoursSinceActivity)} hours ago`,
          url: null
        });
      }
    }

    // If no issues found, add success diagnostic
    if (results.length === 0) {
      results.push({
        severity: 'success',
        category: 'implementation',
        title: 'Pixel healthy',
        description: 'All diagnostic checks passed',
        url: null
      });
    }

    return results;
  }

  private convertToCSV(diagnostics: any[]): string {
    const headers = [
      'ID',
      'Pixel Name',
      'Severity',
      'Category',
      'Title',
      'Description',
      'Status',
      'Last Checked',
      'Created At'
    ];

    const rows = diagnostics.map(d => [
      d.id,
      d.pixels.name,
      d.severity,
      d.category,
      d.title,
      d.description,
      d.status,
      d.last_checked,
      d.created_at
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    return csvContent;
  }
}