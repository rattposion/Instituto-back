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

    let query = Database.query(`
      SELECT
        *,
        pixels!inner(id, name, workspace_id)
      FROM
        conversions
      WHERE
        pixels.workspace_id = ${req.user!.workspaceId}
      ORDER BY
        ${sortBy} ${sortOrder === 'asc' ? 'ASC' : 'DESC'}
      LIMIT
        ${limit}
      OFFSET
        ${offset}
    `);

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    if (pixelId) {
      query = query.eq('pixel_id', pixelId);
    }

    if (isActive !== undefined) {
      query = query.eq('is_active', isActive === 'true');
    }

    const { data: conversions, error, count } = await query;

    if (error) {
      logger.error('Error fetching conversions:', error);
      throw createError('Failed to fetch conversions', 500);
    }

    res.json({
      success: true,
      data: conversions,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / Number(limit))
      }
    });
  }

  async getConversionById(req: AuthRequest, res: Response) {
    const { id } = req.params;

    const { data: conversion, error } = await Database.query(`
      SELECT
        *,
        pixels!inner(id, name, workspace_id)
      FROM
        conversions
      WHERE
        id = ${id}
        AND pixels.workspace_id = ${req.user!.workspaceId}
      LIMIT
        1
    `);

    if (error || !conversion) {
      throw createError('Conversion not found', 404);
    }

    res.json({
      success: true,
      data: conversion
    });
  }

  async createConversion(req: AuthRequest, res: Response) {
    const { name, pixelId, eventName, rules } = req.body;

    // Verify pixel belongs to workspace
    const { data: pixel, error: pixelError } = await Database.query(`
      SELECT
        id
      FROM
        pixels
      WHERE
        id = ${pixelId}
        AND workspace_id = ${req.user!.workspaceId}
      LIMIT
        1
    `);

    if (pixelError || !pixel) {
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
      is_active: true
    };

    const { data: conversion, error } = await Database.query(`
      INSERT INTO
        conversions (id, name, pixel_id, event_name, rules, conversion_rate, total_conversions, total_value, average_value, is_active)
      VALUES
        (${conversionData.id}, ${name}, ${pixelId}, ${eventName}, ${rules}, ${conversionData.conversion_rate}, ${conversionData.total_conversions}, ${conversionData.total_value}, ${conversionData.average_value}, ${conversionData.is_active})
      RETURNING *
    `);

    if (error) {
      logger.error('Error creating conversion:', error);
      throw createError('Failed to create conversion', 500);
    }

    res.status(201).json({
      success: true,
      data: conversion
    });
  }

  async updateConversion(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { name, eventName, rules, isActive } = req.body;

    // Check if conversion exists and belongs to workspace
    const { data: existingConversion, error: fetchError } = await Database.query(`
      SELECT
        *,
        pixels!inner(workspace_id)
      FROM
        conversions
      WHERE
        id = ${id}
        AND pixels.workspace_id = ${req.user!.workspaceId}
      LIMIT
        1
    `);

    if (fetchError || !existingConversion) {
      throw createError('Conversion not found', 404);
    }

    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    if (name !== undefined) updateData.name = name;
    if (eventName !== undefined) updateData.event_name = eventName;
    if (rules !== undefined) updateData.rules = rules;
    if (isActive !== undefined) updateData.is_active = isActive;

    const { data: conversion, error } = await Database.query(`
      UPDATE
        conversions
      SET
        name = ${name},
        event_name = ${eventName},
        rules = ${rules},
        is_active = ${isActive},
        updated_at = ${updateData.updated_at}
      WHERE
        id = ${id}
      RETURNING *
    `);

    if (error) {
      logger.error('Error updating conversion:', error);
      throw createError('Failed to update conversion', 500);
    }

    res.json({
      success: true,
      data: conversion
    });
  }

  async deleteConversion(req: AuthRequest, res: Response) {
    const { id } = req.params;

    // Check if conversion exists and belongs to workspace
    const { data: existingConversion, error: fetchError } = await Database.query(`
      SELECT
        name,
        pixels!inner(workspace_id)
      FROM
        conversions
      WHERE
        id = ${id}
        AND pixels.workspace_id = ${req.user!.workspaceId}
      LIMIT
        1
    `);

    if (fetchError || !existingConversion) {
      throw createError('Conversion not found', 404);
    }

    const { error } = await Database.query(`
      DELETE FROM
        conversions
      WHERE
        id = ${id}
    `);

    if (error) {
      logger.error('Error deleting conversion:', error);
      throw createError('Failed to delete conversion', 500);
    }

    res.json({
      success: true,
      message: 'Conversion deleted successfully'
    });
  }

  async getConversionAnalytics(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { timeframe = '7d' } = req.query;

    // Check if conversion exists and belongs to workspace
    const { data: conversion, error: conversionError } = await Database.query(`
      SELECT
        *,
        pixels!inner(workspace_id)
      FROM
        conversions
      WHERE
        id = ${id}
        AND pixels.workspace_id = ${req.user!.workspaceId}
      LIMIT
        1
    `);

    if (conversionError || !conversion) {
      throw createError('Conversion not found', 404);
    }

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    
    switch (timeframe) {
      case '24h':
        startDate.setDate(startDate.getDate() - 1);
        break;
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      default:
        startDate.setDate(startDate.getDate() - 7);
    }

    // Get conversion events
    const { data: events, error: eventsError } = await Database.query(`
      SELECT
        timestamp,
        parameters
      FROM
        events
      WHERE
        pixel_id = ${conversion.pixel_id}
        AND event_name = ${conversion.event_name}
        AND timestamp >= ${startDate.toISOString()}
        AND timestamp <= ${endDate.toISOString()}
      ORDER BY
        timestamp ASC
    `);

    if (eventsError) {
      logger.error('Error fetching conversion events:', eventsError);
      throw createError('Failed to fetch analytics', 500);
    }

    // Process analytics
    const analytics = this.processConversionAnalytics(events || [], conversion.rules);

    res.json({
      success: true,
      data: analytics
    });
  }

  async getConversionFunnel(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { timeframe = '7d' } = req.query;

    // Check if conversion exists and belongs to workspace
    const { data: conversion, error: conversionError } = await Database.query(`
      SELECT
        *,
        pixels!inner(workspace_id)
      FROM
        conversions
      WHERE
        id = ${id}
        AND pixels.workspace_id = ${req.user!.workspaceId}
      LIMIT
        1
    `);

    if (conversionError || !conversion) {
      throw createError('Conversion not found', 404);
    }

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    
    switch (timeframe) {
      case '24h':
        startDate.setDate(startDate.getDate() - 1);
        break;
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      default:
        startDate.setDate(startDate.getDate() - 7);
    }

    // Get all events for funnel analysis
    const { data: events, error: eventsError } = await Database.query(`
      SELECT
        event_name,
        timestamp,
        parameters
      FROM
        events
      WHERE
        pixel_id = ${conversion.pixel_id}
        AND timestamp >= ${startDate.toISOString()}
        AND timestamp <= ${endDate.toISOString()}
      ORDER BY
        timestamp ASC
    `);

    if (eventsError) {
      logger.error('Error fetching funnel events:', eventsError);
      throw createError('Failed to fetch funnel data', 500);
    }

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
    events?.forEach(event => {
      eventCounts[event.event_name] = (eventCounts[event.event_name] || 0) + 1;
    });

    funnelSteps.forEach(step => {
      step.count = eventCounts[step.eventName] || 0;
    });

    // Calculate conversion rates
    const funnelWithRates = funnelSteps.map((step, index) => {
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