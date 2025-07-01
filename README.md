# Meta Pixel Backend

Backend completo para a plataforma de gerenciamento Meta Pixel desenvolvido em Node.js com TypeScript, Express e Supabase.

## 🚀 Funcionalidades Implementadas

### Autenticação e Autorização
- ✅ Registro e login de usuários
- ✅ JWT tokens com refresh
- ✅ Middleware de autenticação
- ✅ Sistema de roles (admin, manager, viewer)
- ✅ Recuperação de senha
- ✅ Verificação de email

### Gerenciamento de Workspaces
- ✅ Criação e gerenciamento de workspaces
- ✅ Sistema de membros com diferentes permissões
- ✅ Convites para novos membros
- ✅ Isolamento de dados por workspace

### Pixels
- ✅ CRUD completo de pixels
- ✅ Monitoramento de status (ativo, inativo, erro)
- ✅ Estatísticas em tempo real
- ✅ Teste de conexão com Meta API
- ✅ Analytics detalhadas

### Eventos
- ✅ Captura e processamento de eventos
- ✅ Suporte a eventos padrão e customizados
- ✅ Processamento em lote (bulk)
- ✅ Reprocessamento de eventos falhados
- ✅ Analytics de eventos

### Conversões
- ✅ Configuração de conversões customizadas
- ✅ Regras de conversão flexíveis
- ✅ Tracking de funil de conversão
- ✅ Métricas de performance

### Diagnósticos
- ✅ Monitoramento automático de saúde dos pixels
- ✅ Detecção de problemas (implementação, eventos, performance)
- ✅ Sistema de alertas
- ✅ Relatórios de diagnóstico

### Integrações
- ✅ Suporte a GTM, WordPress, Shopify, Webhooks
- ✅ Configuração flexível de integrações
- ✅ Sincronização automática
- ✅ Status de conexão

### Analytics
- ✅ Dashboard com métricas principais
- ✅ Relatórios personalizáveis
- ✅ Exportação de dados
- ✅ Análise de tendências

### Segurança
- ✅ Rate limiting
- ✅ Validação de dados com Joi
- ✅ Sanitização de inputs
- ✅ Logs de auditoria
- ✅ Criptografia de senhas
- ✅ API keys seguras

### Infraestrutura
- ✅ Banco de dados Supabase
- ✅ Migrations automáticas
- ✅ Jobs cron para manutenção
- ✅ Sistema de logs
- ✅ Tratamento de erros
- ✅ Documentação da API

## 🛠️ Tecnologias Utilizadas

- **Node.js** - Runtime JavaScript
- **TypeScript** - Tipagem estática
- **Express** - Framework web
- **Supabase** - Banco de dados PostgreSQL
- **JWT** - Autenticação
- **Joi** - Validação de dados
- **Winston** - Sistema de logs
- **Bcrypt** - Criptografia de senhas
- **Node-cron** - Jobs agendados
- **Rate-limiter-flexible** - Rate limiting

## 📦 Instalação

```bash
cd server
npm install
```

## ⚙️ Configuração

1. Copie o arquivo de exemplo:
```bash
cp .env.example .env
```

2. Configure as variáveis de ambiente:
```env
# Database
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Server
PORT=3001
NODE_ENV=development

# JWT
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRES_IN=7d

# Meta API
META_APP_ID=your_meta_app_id
META_APP_SECRET=your_meta_app_secret
```

## 🚀 Execução

### Desenvolvimento
```bash
npm run dev
```

### Produção
```bash
npm run build
npm start
```

### Migrations
```bash
npm run migrate
```

### Seed (dados de exemplo)
```bash
npm run seed
```

## 📚 Estrutura da API

### Autenticação
- `POST /api/v1/auth/register` - Registro de usuário
- `POST /api/v1/auth/login` - Login
- `POST /api/v1/auth/logout` - Logout
- `GET /api/v1/auth/me` - Perfil do usuário
- `PUT /api/v1/auth/me` - Atualizar perfil
- `PUT /api/v1/auth/change-password` - Alterar senha

### Pixels
- `GET /api/v1/pixels` - Listar pixels
- `POST /api/v1/pixels` - Criar pixel
- `GET /api/v1/pixels/:id` - Obter pixel
- `PUT /api/v1/pixels/:id` - Atualizar pixel
- `DELETE /api/v1/pixels/:id` - Deletar pixel
- `GET /api/v1/pixels/:id/analytics` - Analytics do pixel
- `POST /api/v1/pixels/:id/test` - Testar conexão

### Eventos
- `GET /api/v1/events` - Listar eventos
- `POST /api/v1/events` - Criar evento
- `POST /api/v1/events/bulk` - Criar eventos em lote
- `GET /api/v1/events/analytics/summary` - Analytics de eventos

### Workspaces
- `GET /api/v1/workspaces` - Listar workspaces
- `POST /api/v1/workspaces` - Criar workspace
- `GET /api/v1/workspaces/:id/members` - Membros do workspace
- `POST /api/v1/workspaces/:id/invite` - Convidar membro

## 🔒 Autenticação

Todas as rotas protegidas requerem o header:
```
Authorization: Bearer <jwt_token>
```

## 📊 Monitoramento

O sistema inclui:
- Health check em `/health`
- Logs estruturados com Winston
- Métricas de performance
- Alertas automáticos
- Jobs de manutenção

## 🧪 Testes

```bash
npm test
```

## 📝 Logs

Os logs são salvos em:
- `logs/error.log` - Apenas erros
- `logs/combined.log` - Todos os logs

## 🔧 Jobs Automáticos

- **Diagnósticos**: A cada 15 minutos
- **Limpeza de eventos**: Diariamente às 2h
- **Estatísticas**: A cada hora
- **Reprocessamento**: A cada 30 minutos

## 🚀 Deploy

O backend está pronto para deploy em qualquer plataforma que suporte Node.js:
- Heroku
- Vercel
- Railway
- DigitalOcean
- AWS

## 📈 Escalabilidade

O sistema foi projetado para escalar:
- Banco de dados otimizado com índices
- Rate limiting configurável
- Jobs assíncronos
- Cache de queries
- Paginação em todas as listagens

## 🛡️ Segurança

- Validação rigorosa de inputs
- Sanitização de dados
- Rate limiting por IP
- Logs de auditoria
- Criptografia de senhas
- Tokens JWT seguros
- CORS configurado
- Headers de segurança

## 📞 Suporte

Para dúvidas ou problemas, consulte:
- Logs da aplicação
- Documentação da API
- Health check endpoint