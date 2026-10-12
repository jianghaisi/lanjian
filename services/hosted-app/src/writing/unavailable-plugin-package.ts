/** No uploaded executable plugin packages in the hosted runtime. */
export async function readPluginPackage(): Promise<never> {
  throw new Error('网页版暂时没有插件包安装功能。')
}
