import { Response } from 'express';
import { Database } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class DiagnosticController {
  async getDiagnostics(req: AuthRequest, res: Response) {
    const { page = 1, limit = 20, search, pixelId, severity, category, status, sortBy = 'created_at', sortOrder = 'desc' } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    let baseQuery = 'SELECT * FROM diagnostics WHERE 1=1';
    let params: any[] = [];
    let countQuery = 'SELECT COUNT(*) FROM diagnostics WHERE 1=1';
    let countParams: any[] = [];
    if (req.user && req.user.workspaceId) {
      baseQuery += ' AND workspace_id = $1';
      countQuery += ' AND workspace_id = $1';
      params.push(req.user.workspaceId);
      countParams.push(req.user.workspaceId);
    }
    if (search) {
      baseQuery += ` AND (title ILIKE $${params.length + 1} OR description ILIKE $${params.length + 1})`;
      countQuery += ` AND (title ILIKE $${countParams.length + 1} OR description ILIKE $${countParams.length + 1})`;
      params.push(`%${search}%`);
      countParams.push(`%${search}%`);
    }
    if (pixelId) {
      baseQuery += ` AND pixel_id = $${params.length + 1}`;
      countQuery += ` AND pixel_id = $${countParams.length + 1}`;
      params.push(pixelId);
      countParams.push(pixelId);
    }
    if (severity) {
      baseQuery += ` AND severity = $${params.length + 1}`;
      countQuery += ` AND severity = $${countParams.length + 1}`;
      params.push(severity);
      countParams.push(severity);
    }
    if (category) {
      baseQuery += ` AND category = $${params.length + 1}`;
      countQuery += ` AND category = $${countParams.length + 1}`;
      params.push(category);
      countParams.push(category);
    }
    if (status) {
      baseQuery += ` AND status = $${params.length + 1}`;
      countQuery += ` AND status = $${countParams.length + 1}`;
      params.push(status);
      countParams.push(status);
    }
    baseQuery += ` ORDER BY ${sortBy} ${sortOrder === 'asc' ? 'ASC' : 'DESC'} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    const diagnosticsResult = await Database.query(baseQuery, params);
    const countResult = await Database.query(countQuery, countParams);
    const diagnostics = diagnosticsResult.rows;
    const count = parseInt(countResult.rows[0].count, 10);
    res.json({
      success: true,
      data: diagnostics,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: count,
        totalPages: Math.ceil(count / Number(limit))
      }
    });
  }

  async getDiagnosticById(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const result = await Database.query(
      'SELECT * FROM diagnostics WHERE id = $1 AND workspace_id = $2 LIMIT 1',
      [id, req.user!.workspaceId]
    );
    const diagnostic = result.rows[0];
    if (!diagnostic) {
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
    const pixelResult = await Database.query(
      'SELECT * FROM pixels WHERE id = $1 AND workspace_id = $2 LIMIT 1',
      [pixelId, req.user!.workspaceId]
    );
    if (pixelResult.rows.length === 0) {
      throw createError('Pixel not found', 404);
    }
    // Run various diagnostic checks
    const diagnosticResults = await this.performDiagnosticChecks(pixelResult.rows[0]);
    // Save diagnostic results
    const savedDiagnostics = [];
    for (const result of diagnosticResults) {
      const insertResult = await Database.query(
        'INSERT INTO diagnostics (pixel_id, severity, category, title, description, url, status, last_checked, workspace_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (pixel_id, title) DO UPDATE SET severity = EXCLUDED.severity, category = EXCLUDED.category, title = EXCLUDED.title, description = EXCLUDED.description, url = EXCLUDED.url, status = EXCLUDED.status, last_checked = EXCLUDED.last_checked RETURNING *',
        [pixelId, result.severity, result.category, result.title, result.description, result.url, 'active', new Date().toISOString(), req.user!.workspaceId]
      );
      if (insertResult.rows.length > 0) {
        savedDiagnostics.push(insertResult.rows[0]);
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
    const existingResult = await Database.query(
      'SELECT * FROM diagnostics WHERE id = $1 AND workspace_id = $2 LIMIT 1',
      [id, req.user!.workspaceId]
    );
    if (existingResult.rows.length === 0) {
      throw createError('Diagnostic not found', 404);
    }
    const updateResult = await Database.query(
      'UPDATE diagnostics SET status = $1, last_checked = $2 WHERE id = $3 RETURNING *',
      ['resolved', new Date().toISOString(), id]
    );
    const diagnostic = updateResult.rows[0];
    res.json({
      success: true,
      data: diagnostic
    });
  }

  async getDiagnosticsSummary(req: AuthRequest, res: Response) {
    const result = await Database.query(
      'SELECT severity, category, status FROM diagnostics WHERE workspace_id = $1',
      [req.user!.workspaceId]
    );
    res.json({
      success: true,
      data: result.rows
    });
  }

  async exportDiagnosticsReport(req: AuthRequest, res: Response) {
    const result = await Database.query(
      'SELECT * FROM diagnostics WHERE workspace_id = $1',
      [req.user!.workspaceId]
    );
    const csv = this.convertToCSV(result.rows);
    res.header('Content-Type', 'text/csv');
    res.attachment('diagnostics_report.csv');
    res.send(csv);
  }

  private async performDiagnosticChecks(pixel: any): Promise<any[]> {
    // Simulação de checagens
    return [
      {
        severity: 'warning',
        category: 'performance',
        title: 'Exemplo de diagnóstico',
        description: 'Este é um diagnóstico de exemplo.',
        url: 'https://exemplo.com/diagnostico'
      }
    ];
  }

  private convertToCSV(diagnostics: any[]): string {
    if (!diagnostics.length) return '';
    const header = Object.keys(diagnostics[0]).join(',');
    const rows = diagnostics.map(d => Object.values(d).join(','));
    return [header, ...rows].join('\n');
  }
}