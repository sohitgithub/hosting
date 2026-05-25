import { DataTypes } from 'sequelize';
import bcrypt from 'bcryptjs';
import sequelize from '../config/db.js';

export const User = sequelize.define(
  'User',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false, unique: true },
    password: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.ENUM('user', 'admin'), defaultValue: 'user' },
    avatar: DataTypes.STRING,
    company: DataTypes.STRING,
    plan: { type: DataTypes.STRING, defaultValue: 'starter' },
    paymentMethods: { type: DataTypes.JSON, defaultValue: [] },
    preferences: {
      type: DataTypes.JSON,
      defaultValue: {
        emailAlerts: true,
        deployAlerts: true,
        billingAlerts: true,
        sslAlerts: true,
      },
    },
  },
  { tableName: 'users' }
);

export const Deployment = sequelize.define(
  'Deployment',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    framework: { type: DataTypes.STRING, defaultValue: 'node' },
    region: { type: DataTypes.STRING, defaultValue: 'us-east-1' },
    status: {
      type: DataTypes.ENUM('building', 'deploying', 'live', 'failed', 'stopped'),
      defaultValue: 'building',
    },
    url: DataTypes.STRING,
    cpu: { type: DataTypes.INTEGER, defaultValue: 0 },
    memory: { type: DataTypes.INTEGER, defaultValue: 0 },
    logs: { type: DataTypes.JSON, defaultValue: [] },
  },
  { tableName: 'deployments' }
);

const DEFAULT_NAMESERVERS = ['ns1.syntaxverse.host', 'ns2.syntaxverse.host'];

export const Domain = sequelize.define(
  'Domain',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.ENUM('active', 'pending', 'expired', 'transferring'), defaultValue: 'pending' },
    ssl: { type: DataTypes.BOOLEAN, defaultValue: false },
    sslStatus: {
      type: DataTypes.ENUM('none', 'pending', 'active', 'failed', 'expired'),
      defaultValue: 'none',
    },
    sslIssuedAt: DataTypes.DATE,
    sslExpiresAt: DataTypes.DATE,
    sslError: DataTypes.TEXT,
    dnsRecords: { type: DataTypes.JSON, defaultValue: [] },
    nameservers: { type: DataTypes.JSON, defaultValue: DEFAULT_NAMESERVERS },
    nameserverMode: { type: DataTypes.ENUM('syntaxverse', 'custom'), defaultValue: 'syntaxverse' },
    primaryIp: { type: DataTypes.STRING, defaultValue: '76.76.21.21' },
    ptrRecord: { type: DataTypes.STRING },
    forwarding: {
      type: DataTypes.JSON,
      defaultValue: { enabled: false, type: '301', targetUrl: '', includePath: true },
    },
    reverseProxy: {
      type: DataTypes.JSON,
      defaultValue: { enabled: false, originIp: '', originPort: 80, preserveHost: true },
    },
    transferStatus: {
      type: DataTypes.ENUM('none', 'pending', 'in_progress', 'completed', 'failed'),
      defaultValue: 'none',
    },
    transferAuthCode: DataTypes.STRING,
    registrar: { type: DataTypes.STRING, defaultValue: 'Syntax Verse' },
    expiresAt: DataTypes.DATE,
    sitePublished: { type: DataTypes.BOOLEAN, defaultValue: false },
    sitePublishedAt: DataTypes.DATE,
    siteSlug: { type: DataTypes.STRING, allowNull: true },
  },
  { tableName: 'domains' }
);

export { DEFAULT_NAMESERVERS };

export const Ticket = sequelize.define(
  'Ticket',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    subject: { type: DataTypes.STRING, allowNull: false },
    message: { type: DataTypes.TEXT, allowNull: false },
    status: {
      type: DataTypes.ENUM('open', 'in_progress', 'resolved', 'closed'),
      defaultValue: 'open',
    },
    priority: { type: DataTypes.ENUM('low', 'medium', 'high'), defaultValue: 'medium' },
    category: { type: DataTypes.STRING, defaultValue: 'general' },
    ticketNumber: DataTypes.STRING,
    lastReplyAt: DataTypes.DATE,
    replies: { type: DataTypes.JSON, defaultValue: [] },
  },
  { tableName: 'tickets' }
);

export const HostingAccount = sequelize.define(
  'HostingAccount',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    package: { type: DataTypes.STRING, defaultValue: 'starter' },
    domains: { type: DataTypes.JSON, defaultValue: [] },
    diskUsed: { type: DataTypes.INTEGER, defaultValue: 0 },
    diskLimit: { type: DataTypes.INTEGER, defaultValue: 10240 },
    bandwidth: { type: DataTypes.INTEGER, defaultValue: 0 },
    databases: { type: DataTypes.JSON, defaultValue: [] },
    sslEnabled: { type: DataTypes.BOOLEAN, defaultValue: false },
    status: { type: DataTypes.ENUM('active', 'suspended', 'pending'), defaultValue: 'active' },
    emailAccounts: { type: DataTypes.JSON, defaultValue: [] },
    cronJobs: { type: DataTypes.JSON, defaultValue: [] },
    lastRestartAt: DataTypes.DATE,
    serverLabel: { type: DataTypes.STRING, defaultValue: 'svh-node-01' },
    meta: { type: DataTypes.JSON, defaultValue: {} },
  },
  { tableName: 'hosting_accounts' }
);

export const Invoice = sequelize.define(
  'Invoice',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    description: DataTypes.STRING,
    status: { type: DataTypes.ENUM('paid', 'pending', 'failed'), defaultValue: 'pending' },
    dueDate: DataTypes.DATE,
    paidAt: DataTypes.DATE,
    paymentMethodId: DataTypes.STRING,
    invoiceNumber: DataTypes.STRING,
  },
  { tableName: 'invoices' }
);

export const UserDatabase = sequelize.define(
  'UserDatabase',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    dbName: { type: DataTypes.STRING, allowNull: false },
    dbUser: { type: DataTypes.STRING, allowNull: false },
    dbPassword: { type: DataTypes.STRING, allowNull: false },
    host: { type: DataTypes.STRING, defaultValue: 'localhost' },
    port: { type: DataTypes.INTEGER, defaultValue: 3306 },
    engine: { type: DataTypes.STRING, defaultValue: 'mysql' },
    status: {
      type: DataTypes.ENUM('running', 'stopped', 'importing', 'error'),
      defaultValue: 'running',
    },
    sizeBytes: { type: DataTypes.BIGINT, defaultValue: 0 },
  },
  { tableName: 'user_databases' }
);

export const ApiKey = sequelize.define(
  'ApiKey',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false, defaultValue: 'API Key' },
    keyPrefix: { type: DataTypes.STRING, allowNull: false },
    keyHash: { type: DataTypes.STRING(64), allowNull: false },
    scopes: { type: DataTypes.JSON, defaultValue: ['full'] },
    lastUsedAt: DataTypes.DATE,
    expiresAt: DataTypes.DATE,
  },
  { tableName: 'api_keys', indexes: [{ fields: ['user_id'] }, { unique: true, fields: ['key_hash'] }] }
);

export const Backup = sequelize.define(
  'Backup',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    type: { type: DataTypes.ENUM('full', 'incremental'), defaultValue: 'full' },
    status: {
      type: DataTypes.ENUM('pending', 'completed', 'failed'),
      defaultValue: 'pending',
    },
    label: { type: DataTypes.STRING, defaultValue: 'Backup' },
    sizeBytes: { type: DataTypes.BIGINT, defaultValue: 0 },
    storagePath: DataTypes.STRING,
    error: DataTypes.TEXT,
    meta: { type: DataTypes.JSON, defaultValue: {} },
    completedAt: DataTypes.DATE,
  },
  { tableName: 'backups' }
);

export const ActivityLog = sequelize.define(
  'ActivityLog',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: true },
    level: {
      type: DataTypes.ENUM('info', 'success', 'warn', 'error'),
      defaultValue: 'info',
    },
    source: {
      type: DataTypes.STRING,
      defaultValue: 'system',
    },
    message: { type: DataTypes.TEXT, allowNull: false },
    meta: { type: DataTypes.JSON, allowNull: true },
  },
  {
    tableName: 'activity_logs',
    updatedAt: false,
    indexes: [{ fields: ['user_id', 'created_at'] }, { fields: ['source'] }],
  }
);

User.hasMany(Deployment, { foreignKey: 'userId', as: 'deployments' });
User.hasMany(Domain, { foreignKey: 'userId', as: 'domains' });
User.hasMany(Ticket, { foreignKey: 'userId', as: 'tickets' });
User.hasMany(HostingAccount, { foreignKey: 'userId', as: 'hostingAccounts' });
User.hasMany(Invoice, { foreignKey: 'userId', as: 'invoices' });
User.hasMany(ActivityLog, { foreignKey: 'userId', as: 'activityLogs' });
User.hasMany(UserDatabase, { foreignKey: 'userId', as: 'userDatabases' });
User.hasMany(Backup, { foreignKey: 'userId', as: 'backups' });
User.hasMany(ApiKey, { foreignKey: 'userId', as: 'apiKeys' });

Deployment.belongsTo(User, { foreignKey: 'userId' });
Domain.belongsTo(User, { foreignKey: 'userId' });
Ticket.belongsTo(User, { foreignKey: 'userId' });
HostingAccount.belongsTo(User, { foreignKey: 'userId' });
Invoice.belongsTo(User, { foreignKey: 'userId' });
ActivityLog.belongsTo(User, { foreignKey: 'userId' });
UserDatabase.belongsTo(User, { foreignKey: 'userId' });
Backup.belongsTo(User, { foreignKey: 'userId' });
ApiKey.belongsTo(User, { foreignKey: 'userId' });

User.beforeCreate(async (user) => {
  if (user.password) {
    user.password = await bcrypt.hash(user.password, 12);
  }
});

User.beforeUpdate(async (user) => {
  if (user.changed('password')) {
    user.password = await bcrypt.hash(user.password, 12);
  }
});

export const hashPassword = (plain) => bcrypt.hash(plain, 12);
export const comparePassword = (plain, hash) => bcrypt.compare(plain, hash);

/** Set password once (skips Sequelize hooks — use for CLI/admin tools). */
export async function setPasswordWithoutHooks(userOrId, plainPassword) {
  const hash = await hashPassword(plainPassword);
  const id = typeof userOrId === 'object' ? userOrId.id : userOrId;
  await User.update({ password: hash }, { where: { id }, hooks: false, individualHooks: false });
  return hash;
}

export const syncModels = async () => {
  // alter:true on every boot duplicates indexes (MySQL max 64/table). Use DB_SYNC_ALTER=true only when needed.
  const alter = process.env.DB_SYNC_ALTER === 'true';
  await sequelize.sync({ alter });
  console.log(`Database tables ready${alter ? ' (alter mode)' : ''}`);
};

export default sequelize;
