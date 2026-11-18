; Personalização do instalador do Controle SST.
; Sugere instalar em E:\Controle SST quando a unidade E: existe.
; A pasta continua podendo ser trocada na tela "Escolher local de instalação".
; Os dados ficam em "<unidade>:\Controle SST - Dados" (fora da pasta do programa,
; para não serem apagados ao atualizar ou desinstalar).

!macro preInit
  IfFileExists "E:\*.*" 0 semUnidadeE
    SetRegView 64
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "E:\Controle SST"
    SetRegView 32
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "E:\Controle SST"
  semUnidadeE:
!macroend
