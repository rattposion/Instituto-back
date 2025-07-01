import { Response } from 'express';
import { Database } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class ConversionController {
  async getConversions(req: AuthRequest, res: Response) {
    const { page = 1, limit = 20, search, pixelId, isActive, sortBy = 'created_at', sortOrder = 'desc' } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    let whereClauses: string[] = ['p.workspace_id = $1'];
    let params: any[] = [req.user!.workspaceId];
    let paramIndex = 2;
    if (search) {
      whereClauses.push('c.name ILIKE $' + paramIndex);
      params.push(`%${search}%`);
      paramIndex++;
    }
    if (pixelId) {
      whereClauses.push('c.pixel_id = $' + paramIndex);
      params.push(pixelId);
      paramIndex++;
    }
    if (isActive !== undefined) {
      whereClauses.push('c.is_active = $' + paramIndex);
      params.push(isActive === 'true');
      paramIndex++;
    }
    const where = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';
    const sql = `SELECT c.*, p.id as pixel_id, p.name as pixel_name, p.workspace_id, count(*) OVER() AS total_count FROM conversions c INNER JOIN pixels p ON c.pixel_id = p.id ${where} ORDER BY c.${sortBy} ${sortOrder === 'asc' ? 'ASC' : 'DESC'} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(Number(limit), offset);
    const result = await Database.query(sql, params);
    const conversions = result.rows;
    const total = conversions.length > 0 ? Number(conversions[0].total_count) : 0;
    res.json({
      success: true,
      data: conversions,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit))
      }
    });
  }

  async getConversionById(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const sql = `SELECT c.*, p.id as pixel_id, p.name as pixel_name, p.workspace_id FROM conversions c INNER JOIN pixels p ON c.pixel_id = p.id WHERE c.id = $1 AND p.workspace_id = $2 LIMIT 1`;
    const result = await Database.query(sql, [id, req.user!.workspaceId]);
    const conversion = result.rows[0];
    if (!conversion) {
      throw createError('Conversion not found', 404);
    }
    res.json({
      success: true,
      data: conversion
    });
  }

  async createConversion(req: AuthRequest, res: Response) {
    const { name, pixelId, eventName, rules } = req.body;
    // Verifica pixel
    const pixelResult = await Database.query('SELECT id FROM pixels WHERE id = $1 AND workspace_id = $2 LIMIT 1', [pixelId, req.user!.workspaceId]);
    const pixel = pixelResult.rows[0];
    if (!pixel) {
      throw createError('Pixel not found', 404);
    }
    const conversionData = {
      id: uuidv4(),
      name,
      pixel_id: pixelId,
      event_name: eventName,
      rules: rules || [],
      conversion_rate: 0,
      total_conversions: 0,
      total_value: 0,
      average_value: 0,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const sql = `INSERT INTO conversions (id, name, pixel_id, event_name, rules, conversion_rate, total_conversions, total_value, average_value, is_active, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`;
    const values = [conversionData.id, conversionData.name, conversionData.pixel_id, conversionData.event_name, JSON.stringify(conversionData.rules), conversionData.conversion_rate, conversionData.total_conversions, conversionData.total_value, conversionData.average_value, conversionData.is_active, conversionData.created_at, conversionData.updated_at];
    const result = await Database.query(sql, values);
    const conversion = result.rows[0];
    res.status(201).json({
      success: true,
      data: conversion
    });
  }

  async updateConversion(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { name, eventName, rules, isActive } = req.body;
    // Verifica se existe e pertence ao workspace
    const check = await Database.query('SELECT c.*, p.workspace_id FROM conversions c INNER JOIN pixels p ON c.pixel_id = p.id WHERE c.id = $1 AND p.workspace_id = $2 LIMIT 1', [id, req.user!.workspaceId]);
    const existingConversion = check.rows[0];
    if (!existingConversion) {
      throw createError('Conversion not found', 404);
    }
    const updateFields: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;
    if (name !== undefined) { updateFields.push(`name = $${paramIndex}`); params.push(name); paramIndex++; }
    if (eventName !== undefined) { updateFields.push(`event_name = $${paramIndex}`); params.push(eventName); paramIndex++; }
    if (rules !== undefined) { updateFields.push(`rules = $${paramIndex}`); params.push(JSON.stringify(rules)); paramIndex++; }
    if (isActive !== undefined) { updateFields.push(`is_active = $${paramIndex}`); params.push(isActive); paramIndex++; }
    updateFields.push(`updated_at = $${paramIndex}`); params.push(new Date().toISOString()); paramIndex++;
    params.push(id);
    const sql = `UPDATE conversions SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
    const result = await Database.query(sql, params);
    const conversion = result.rows[0];
    res.json({
      success: true,
      data: conversion
    });
  }

  async deleteConversion(req: AuthRequest, res: Response) {
    const { id } = req.params;
    // Verifica se existe e pertence ao workspace
    const check = await Database.query('SELECT c.*, p.workspace_id FROM conversions c INNER JOIN pixels p ON c.pixel_id = p.id WHERE c.id = $1 AND p.workspace_id = $2 LIMIT 1', [id, req.user!.workspaceId]);
    const existingConversion = check.rows[0];
    if (!existingConversion) {
      throw createError('Conversion not found', 404);
    }
    await Database.query('DELETE FROM conversions WHERE id = $1', [id]);
    res.json({
      success: true,
      message: 'Conversion deleted successfully'
    });
  }

  async getConversionAnalytics(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { timeframe = '7d' } = req.query;
    // Verifica se existe e pertence ao workspace
    const check = await Database.query('SELECT c.*, p.workspace_id FROM conversions c INNER JOIN pixels p ON c.pixel_id = p.id WHERE c.id = $1 AND p.workspace_id = $2 LIMIT 1', [id, req.user!.workspaceId]);
    const conversion = check.rows[0];
    if (!conversion) {
      throw createError('Conversion not found', 404);
    }
    // Datas
    const endDate = new Date();
    const startDate = new Date();
    switch (timeframe) {
      case '24h': startDate.setDate(startDate.getDate() - 1); break;
      case '7d': startDate.setDate(startDate.getDate() - 7); break;
      case '30d': startDate.setDate(startDate.getDate() - 30); break;
      default: startDate.setDate(startDate.getDate() - 7);
    }
    // Busca eventos
    const eventsResult = await Database.query('SELECT timestamp, parameters FROM events WHERE pixel_id = $1 AND event_name = $2 AND timestamp >= $3 AND timestamp <= $4 ORDER BY timestamp ASC', [conversion.pixel_id, conversion.event_name, startDate.toISOString(), endDate.toISOString()]);
    const events = eventsResult.rows;
    const analytics = this.processConversionAnalytics(events || [], conversion.rules);
    res.json({
      success: true,
      data: analytics
    });
  }

  async getConversionFunnel(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { timeframe = '7d' } = req.query;
    // Verifica se existe e pertence ao workspace
    const check = await Database.query('SELECT c.*, p.workspace_id FROM conversions c INNER JOIN pixels p ON c.pixel_id = p.id WHERE c.id = $1 AND p.workspace_id = $2 LIMIT 1', [id, req.user!.workspaceId]);
    const conversion = check.rows[0];
    if (!conversion) {
      throw createError('Conversion not found', 404);
    }
    // Datas
    const endDate = new Date();
    const startDate = new Date();
    switch (timeframe) {
      case '24h': startDate.setDate(startDate.getDate() - 1); break;
      case '7d': startDate.setDate(startDate.getDate() - 7); break;
      case '30d': startDate.setDate(startDate.getDate() - 30); break;
      default: startDate.setDate(startDate.getDate() - 7);
    }
    // Busca eventos
    const eventsResult = await Database.query('SELECT event_name, timestamp, parameters FROM events WHERE pixel_id = $1 AND timestamp >= $2 AND timestamp <= $3 ORDER BY timestamp ASC', [conversion.pixel_id, startDate.toISOString(), endDate.toISOString()]);
    const events = eventsResult.rows;
    // Build funnel steps
    const funnelSteps = [
      { name: 'Visitors', eventName: 'PageView', count: 0 },
      { name: 'Product Views', eventName: 'ViewContent', count: 0 },
      { name: 'Add to Cart', eventName: 'AddToCart', count: 0 },
      { name: 'Initiate Checkout', eventName: 'InitiateCheckout', count: 0 },
      { name: 'Purchase', eventName: 'Purchase', count: 0 }
    ];
    // Count events for each step
    const eventCounts: { [key: string]: number } = {};
    events?.forEach((event: any) => {
      eventCounts[event.event_name] = (eventCounts[event.event_name] || 0) + 1;
    });
    funnelSteps.forEach((step: any) => {
      step.count = eventCounts[step.eventName] || 0;
    });
    // Calculate conversion rates
    const funnelWithRates = funnelSteps.map((step: any, index: number) => {
      const previousStep = index > 0 ? funnelSteps[index - 1] : null;
      const conversionRate = previousStep && previousStep.count > 0 
        ? (step.count / previousStep.count) * 100 
        : 100;
      return {
        ...step,
        conversionRate: Math.round(conversionRate * 100) / 100
      };
    });
    res.json({
      success: true,
      data: {
        steps: funnelWithRates,
        totalVisitors: funnelSteps[0].count,
        totalConversions: funnelSteps[funnelSteps.length - 1].count,
        overallConversionRate: funnelSteps[0].count > 0 
          ? (funnelSteps[funnelSteps.length - 1].count / funnelSteps[0].count) * 100 
          : 0
      }
    });
  }

  private processConversionAnalytics(events: any[], rules: any[]) {
    const conversionsByDay: { [key: string]: number } = {};
    const valueByDay: { [key: string]: number } = {};
    
    let totalConversions = 0;
    let totalValue = 0;

    events.forEach(event => {
      // Check if event matches conversion rules
      const matchesRules = this.eventMatchesRules(event, rules);
      
      if (matchesRules) {
        const day = new Date(event.timestamp).toISOString().split('T')[0];
        conversionsByDay[day] = (conversionsByDay[day] || 0) + 1;
        
        const value = parseFloat(event.parameters?.value || 0);
        valueByDay[day] = (valueByDay[day] || 0) + value;
        
        totalConversions++;
        totalValue += value;
      }
    });

    return {
      totalConversions,
      totalValue,
      averageValue: totalConversions > 0 ? totalValue / totalConversions : 0,
      conversionsByDay,
      valueByDay
    };
  }

  private eventMatchesRules(event: any, rules: any[]): boolean {
    if (!rules || rules.length === 0) return true;

    return rules.every(rule => {
      const { type, operator, field, value } = rule;
      
      let fieldValue: any;
      
      switch (type) {
        case 'event':
          fieldValue = event.event_name;
          break;
        case 'parameter':
          fieldValue = event.parameters?.[field];
          break;
        case 'url':
          fieldValue = event.parameters?.page_location || '';
          break;
        default:
          return false;
      }

      return this.compareValues(fieldValue, operator, value);
    });
  }

  private compareValues(fieldValue: any, operator: string, ruleValue: any): boolean {
    const fieldStr = String(fieldValue || '').toLowerCase();
    const ruleStr = String(ruleValue || '').toLowerCase();

    switch (operator) {
      case 'equals':
        return fieldValue === ruleValue;
      case 'contains':
        return fieldStr.includes(ruleStr);
      case 'starts_with':
        return fieldStr.startsWith(ruleStr);
      case 'ends_with':
        return fieldStr.endsWith(ruleStr);
      case 'greater_than':
        return parseFloat(fieldValue) > parseFloat(ruleValue);
      case 'less_than':
        return parseFloat(fieldValue) < parseFloat(ruleValue);
      default:
        return false;
    }
  }
}