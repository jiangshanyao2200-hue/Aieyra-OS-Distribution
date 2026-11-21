import { ActionButton } from "./ui";

export default function WorkspaceProductDialog({ openAccount }: { openAccount: () => void }) {
  return <section className="workspace-product-section">
    <h3>Aieyra Workspace</h3>
    <p>免费开源 · MIT License</p>
    <p>工作台免费使用，无需激活码。</p>
    <p>支持 Eyra 官方账号、官方模型，以及自定义和本地模型连接。模型服务费用与额度由所选服务提供方决定。</p>
    <ActionButton onClick={openAccount}>连接 Eyra 官方账号</ActionButton>
  </section>;
}
