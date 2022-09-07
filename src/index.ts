import { program } from 'commander'; //https://github.com/tj/commander.js/blob/master/Readme_zh-CN.md
/*
index只是一个命令行工具，用于集成支持的子命令
各子命令中自行维护自己的命令行参数
*/
program
  .command('watch_seaport', '监控seaport的事件并同步到wedid chain.', {
    executableFile: 'watchSeaport',
  })
  .command('report', '查看wedid chain上的合约状态', {
    executableFile: 'monitorReport',
  });
program.parse();
