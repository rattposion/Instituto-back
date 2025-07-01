import { Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class EventController {
  async getEvents(req: AuthRequest, res: Response) {
    const { 
      page = 1, 
      limit = 20, 
      search, 
      pixelId, 
      eventName, 
      status,
      startDate,
      endDate,
      sortBy = 'timestamp', 
      sortOrder = 'desc' 
    } = req.query;
    
    const offset = (Number(page) - 1) * Number(limit);

    let query = prisma.event.findMany({
      select: {
        id: true,
        event_name: true,
        timestamp: true,
        processed: true,
        error_message: true,
        parameters: true,
        pixels: {
          select: {
            id: true,
            name: true,
            workspace_id: true
          }
        }
      },
      where: {
        pixels: {
          workspace_id: req.user!.workspaceId
        }
      },
      take: Number(limit),
      skip: offset,
      orderBy: {
        [sortBy as string]: sortOrder === 'asc' ? 'asc' : 'desc'
      }
    });

    if (search) {
      query = prisma.event.findMany({
        where: {
          OR: [
            { event_name: { contains: search, mode: 'insensitive' } },
            { source: { contains: search, mode: 'insensitive' } }
          ]
        },
        select: {
          id: true,
          event_name: true,
          timestamp: true,
          processed: true,
          error_message: true,
          parameters: true,
          pixels: {
            select: {
              id: true,
              name: true,
              workspace_id: true
            }
          }
        },
        where: {
          pixels: {
            workspace_id: req.user!.workspaceId
          }
        },
        take: Number(limit),
        skip: offset,
        orderBy: {
          [sortBy as string]: sortOrder === 'asc' ? 'asc' : 'desc'
        }
      });
    }

    if (pixelId) {
      query = prisma.event.findMany({
        where: {
          pixel_id: pixelId
        },
        select: {
          id: true,
          event_name: true,
          timestamp: true,
          processed: true,
          error_message: true,
          parameters: true,
          pixels: {
            select: {
              id: true,
              name: true,
              workspace_id: true
            }
          }
        },
        where: {
          pixels: {
            workspace_id: req.user!.workspaceId
          }
        },
        take: Number(limit),
        skip: offset,
        orderBy: {
          [sortBy as string]: sortOrder === 'asc' ? 'asc' : 'desc'
        }
      });
    }

    if (eventName) {
      query = prisma.event.findMany({
        where: {
          event_name: eventName
        },
        select: {
          id: true,
          event_name: true,
          timestamp: true,
          processed: true,
          error_message: true,
          parameters: true,
          pixels: {
            select: {
              id: true,
              name: true,
              workspace_id: true
            }
          }
        },
        where: {
          pixels: {
            workspace_id: req.user!.workspaceId
          }
        },
        take: Number(limit),
        skip: offset,
        orderBy: {
          [sortBy as string]: sortOrder === 'asc' ? 'asc' : 'desc'
        }
      });
    }

    if (status === 'processed') {
      query = prisma.event.findMany({
        where: {
          processed: true
        },
        select: {
          id: true,
          event_name: true,
          timestamp: true,
          processed: true,
          error_message: true,
          parameters: true,
          pixels: {
            select: {
              id: true,
              name: true,
              workspace_id: true
            }
          }
        },
        where: {
          pixels: {
            workspace_id: req.user!.workspaceId
          }
        },
        take: Number(limit),
        skip: offset,
        orderBy: {
          [sortBy as string]: sortOrder === 'asc' ? 'asc' : 'desc'
        }
      });
    } else if (status === 'error') {
      query = prisma.event.findMany({
        where: {
          error_message: { not: null }
        },
        select: {
          id: true,
          event_name: true,
          timestamp: true,
          processed: true,
          error_message: true,
          parameters: true,
          pixels: {
            select: {
              id: true,
              name: true,
              workspace_id: true
            }
          }
        },
        where: {
          pixels: {
            workspace_id: req.user!.workspaceId
          }
        },
        take: Number(limit),
        skip: offset,
        orderBy: {
          [sortBy as string]: sortOrder === 'asc' ? 'asc' : 'desc'
        }
      });
    } else if (status === 'pending') {
      query = prisma.event.findMany({
        where: {
          processed: false,
          error_message: null
        },
        select: {
          id: true,
          event_name: true,
          timestamp: true,
          processed: true,
          error_message: true,
          parameters: true,
          pixels: {
            select: {
              id: true,
              name: true,
              workspace_id: true
            }
          }
        },
        where: {
          pixels: {
            workspace_id: req.user!.workspaceId
          }
        },
        take: Number(limit),
        skip: offset,
        orderBy: {
          [sortBy as string]: sortOrder === 'asc' ? 'asc' : 'desc'
        }
      });
    }

    if (startDate) {
      query = prisma.event.findMany({
        where: {
          timestamp: {
            gte: new Date(startDate)
          }
        },
        select: {
          id: true,
          event_name: true,
          timestamp: true,
          processed: true,
          error_message: true,
          parameters: true,
          pixels: {
            select: {
              id: true,
              name: true,
              workspace_id: true
            }
          }
        },
        where: {
          pixels: {
            workspace_id: req.user!.workspaceId
          }
        },
        take: Number(limit),
        skip: offset,
        orderBy: {
          [sortBy as string]: sortOrder === 'asc' ? 'asc' : 'desc'
        }
      });
    }

    if (endDate) {
      query = prisma.event.findMany({
        where: {
          timestamp: {
            lte: new Date(endDate)
          }
        },
        select: {
          id: true,
          event_name: true,
          timestamp: true,
          processed: true,
          error_message: true,
          parameters: true,
          pixels: {
            select: {
              id: true,
              name: true,
              workspace_id: true
            }
          }
        },
        where: {
          pixels: {
            workspace_id: req.user!.workspaceId
          }
        },
        take: Number(limit),
        skip: offset,
        orderBy: {
          [sortBy as string]: sortOrder === 'asc' ? 'asc' : 'desc'
        }
      });
    }

    const { data: events, error, count } = await query;

    if (error) {
      logger.error('Error fetching events:', error);
      throw createError('Failed to fetch events', 500);
    }

    res.json({
      success: true,
      data: events,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / Number(limit))
      }
    });
  }

  async getEventById(req: AuthRequest, res: Response) {
    const { id } = req.params;

    const { data: event, error } = await prisma.event.findUnique({
      where: {
        id: id
      },
      select: {
        id: true,
        event_name: true,
        timestamp: true,
        processed: true,
        error_message: true,
        parameters: true,
        pixels: {
          select: {
            id: true,
            name: true,
            workspace_id: true
          }
        }
      }
    });

    if (error || !event) {
      throw createError('Event not found', 404);
    }

    res.json({
      success: true,
      data: event
    });
  }

  async createEvent(req: AuthRequest, res: Response) {
    const { pixelId, eventName, eventType, parameters, source, userAgent, ipAddress } = req.body;

    // Verify pixel belongs to workspace
    const { data: pixel, error: pixelError } = await supabase
      .from('pixels')
      .select('id')
      .eq('id', pixelId)
      .eq('workspace_id', req.user!.workspaceId)
      .single();

    if (pixelError || !pixel) {
      throw createError('Pixel not found', 404);
    }

    const eventData = {
      id: uuidv4(),
      pixel_id: pixelId,
      event_name: eventName,
      event_type: eventType || 'standard',
      parameters: parameters || {},
      source: source || 'web',
      user_agent: userAgent || req.get('User-Agent'),
      ip_address: ipAddress || req.ip,
      timestamp: new Date().toISOString(),
      processed: false
    };

    const { data: event, error } = await supabase
      .from('events')
      .insert(eventData)
      .select()
      .single();

    if (error) {
      logger.error('Error creating event:', error);
      throw createError('Failed to create event', 500);
    }

    // Process event asynchronously
    this.processEventAsync(event);

    res.status(201).json({
      success: true,
      data: event
    });
  }

  async bulkCreateEvents(req: AuthRequest, res: Response) {
    const { events } = req.body;

    if (!Array.isArray(events) || events.length === 0) {
      throw createError('Events array is required', 400);
    }

    if (events.length > 100) {
      throw createError('Maximum 100 events per batch', 400);
    }

    // Verify all pixels belong to workspace
    const pixelIds = [...new Set(events.map(e => e.pixelId))];
    const { data: pixels, error: pixelError } = await supabase
      .from('pixels')
      .select('id')
      .eq('workspace_id', req.user!.workspaceId)
      .in('id', pixelIds);

    if (pixelError || pixels.length !== pixelIds.length) {
      throw createError('One or more pixels not found', 404);
    }

    const eventData = events.map(event => ({
      id: uuidv4(),
      pixel_id: event.pixelId,
      event_name: event.eventName,
      event_type: event.eventType || 'standard',
      parameters: event.parameters || {},
      source: event.source || 'server',
      user_agent: event.userAgent,
      ip_address: event.ipAddress,
      timestamp: event.timestamp || new Date().toISOString(),
      processed: false
    }));

    const { data: createdEvents, error } = await supabase
      .from('events')
      .insert(eventData)
      .select();

    if (error) {
      logger.error('Error creating bulk events:', error);
      throw createError('Failed to create events', 500);
    }

    // Process events asynchronously
    createdEvents.forEach(event => this.processEventAsync(event));

    res.status(201).json({
      success: true,
      data: {
        created: createdEvents.length,
        events: createdEvents
      }
    });
  }

  async getEventsAnalytics(req: AuthRequest, res: Response) {
    const { timeframe = '7d', pixelId } = req.query;

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    
    switch (timeframe) {
      case '1h':
        startDate.setHours(startDate.getHours() - 1);
        break;
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

    let query = supabase
      .from('events')
      .select(`
        event_name, timestamp, processed, error_message, parameters,
        pixels!inner(workspace_id)
      `)
      .eq('pixels.workspace_id', req.user!.workspaceId)
      .gte('timestamp', startDate.toISOString())
      .lte('timestamp', endDate.toISOString());

    if (pixelId) {
      query = query.eq('pixel_id', pixelId);
    }

    const { data: events, error } = await query;

    if (error) {
      logger.error('Error fetching events analytics:', error);
      throw createError('Failed to fetch analytics', 500);
    }

    const analytics = this.processEventsAnalytics(events || []);

    res.json({
      success: true,
      data: analytics
    });
  }

  async reprocessFailedEvents(req: AuthRequest, res: Response) {
    const { pixelId, limit = 100 } = req.body;

    let query = supabase
      .from('events')
      .select(`
        *,
        pixels!inner(workspace_id)
      `)
      .eq('pixels.workspace_id', req.user!.workspaceId)
      .not('error_message', 'is', null)
      .limit(Number(limit));

    if (pixelId) {
      query = query.eq('pixel_id', pixelId);
    }

    const { data: failedEvents, error } = await query;

    if (error) {
      logger.error('Error fetching failed events:', error);
      throw createError('Failed to fetch failed events', 500);
    }

    // Reprocess events
    let reprocessedCount = 0;
    for (const event of failedEvents) {
      try {
        await this.processEvent(event);
        reprocessedCount++;
      } catch (error) {
        logger.error(`Failed to reprocess event ${event.id}:`, error);
      }
    }

    res.json({
      success: true,
      data: {
        totalFailed: failedEvents.length,
        reprocessed: reprocessedCount
      }
    });
  }

  private async processEventAsync(event: any) {
    try {
      await this.processEvent(event);
    } catch (error) {
      logger.error(`Failed to process event ${event.id}:`, error);
    }
  }

  private async processEvent(event: any) {
    try {
      // Simulate event processing logic
      // In a real implementation, this would:
      // 1. Validate event data
      // 2. Send to Meta Pixel API
      // 3. Update conversion tracking
      // 4. Trigger any webhooks

      const processed = Math.random() > 0.1; // 90% success rate
      const updateData: any = {
        processed,
        updated_at: new Date().toISOString()
      };

      if (!processed) {
        updateData.error_message = 'Simulated processing error';
      } else {
        updateData.error_message = null;
        
        // Update pixel statistics
        await this.updatePixelStats(event.pixel_id, event);
      }

      await supabase
        .from('events')
        .update(updateData)
        .eq('id', event.id);

    } catch (error) {
      await supabase
        .from('events')
        .update({
          processed: false,
          error_message: error.message,
          updated_at: new Date().toISOString()
        })
        .eq('id', event.id);
      
      throw error;
    }
  }

  private async updatePixelStats(pixelId: string, event: any) {
    // Update pixel events count and revenue
    const { data: pixel } = await supabase
      .from('pixels')
      .select('events_count, conversions_count, revenue')
      .eq('id', pixelId)
      .single();

    if (pixel) {
      const updateData: any = {
        events_count: pixel.events_count + 1,
        last_activity: new Date().toISOString()
      };

      if (event.event_name === 'Purchase' && event.parameters?.value) {
        updateData.conversions_count = pixel.conversions_count + 1;
        updateData.revenue = pixel.revenue + parseFloat(event.parameters.value);
      }

      await supabase
        .from('pixels')
        .update(updateData)
        .eq('id', pixelId);
    }
  }

  private processEventsAnalytics(events: any[]) {
    const eventsByDay: { [key: string]: number } = {};
    const eventsByType: { [key: string]: number } = {};
    const errorsByDay: { [key: string]: number } = {};
    
    let totalProcessed = 0;
    let totalErrors = 0;
    let totalRevenue = 0;

    events.forEach(event => {
      const day = new Date(event.timestamp).toISOString().split('T')[0];
      
      eventsByDay[day] = (eventsByDay[day] || 0) + 1;
      eventsByType[event.event_name] = (eventsByType[event.event_name] || 0) + 1;

      if (event.processed) {
        totalProcessed++;
      }

      if (event.error_message) {
        totalErrors++;
        errorsByDay[day] = (errorsByDay[day] || 0) + 1;
      }

      if (event.event_name === 'Purchase' && event.parameters?.value) {
        totalRevenue += parseFloat(event.parameters.value);
      }
    });

    return {
      totalEvents: events.length,
      totalProcessed,
      totalErrors,
      successRate: events.length > 0 ? (totalProcessed / events.length) * 100 : 0,
      totalRevenue,
      eventsByDay,
      eventsByType,
      errorsByDay,
      topEvents: Object.entries(eventsByType)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .map(([name, count]) => ({ name, count }))
    };
  }
}