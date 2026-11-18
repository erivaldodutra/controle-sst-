; Personalização do instalador do Controle SST.
; Sugere instalar em E:\Controle SST quando a unidade E: existe (disco fixo ou removível).
; A pasta continua podendo ser trocada na tela "Escolher local de instalação".
; Os dados ficam em "<unidade>:\Controle SST - Dados" (fora da pasta do programa,
; para não serem apagados ao atualizar ou desinstalar).
;
; Usa GetDriveType em vez de IfFileExists "E:\*.*", que falha quando a unidade está vazia.
; 2 = removível, 3 = disco fixo. CD/DVD (5) e unidade inexistente (1) ficam de fora.

!macro preInit
  System::Call 'kernel32::GetDriveTypeW(w "E:\") i .r0'
  StrCmp $0 "3" usarUnidadeE
  StrCmp $0 "2" usarUnidadeE semUnidadeE
  usarUnidadeE:
    SetRegView 64
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "E:\Controle SST"
    SetRegView 32
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "E:\Controle SST"
  semUnidadeE:
!macroend
