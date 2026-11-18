// Guias de conexão para iniciantes. Fonte única: página /integrations (UI) e Tool get_integration_setup_guide (Hermes).
// A ordem e os ids espelham o enum `integration_provider` do banco.
export const INTEGRATION_PROVIDERS = [
  "instagram",
  "facebook_page",
  "meta_ads",
  "google_business",
  "google_calendar",
  "telegram",
] as const;

export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export type IntegrationGuide = {
  provider: IntegrationProvider;
  name: string;
  description: string;
  requirements: string[];
  steps: { title: string; detail: string }[];
  tips: string[];
};

export const INTEGRATION_CATALOG: IntegrationGuide[] = [
  {
    provider: "instagram",
    name: "Instagram Business",
    description: "Publique e agende posts, Reels, Stories e carrosséis e acompanhe os resultados do seu perfil.",
    requirements: [
      "Conta do Instagram profissional (Empresa ou Criador de conteúdo).",
      "Página do Facebook da empresa vinculada ao Instagram.",
      "Ser administrador dessa Página do Facebook.",
    ],
    steps: [
      {
        title: "Transforme o Instagram em conta profissional",
        detail:
          "No app do Instagram, toque na sua foto de perfil, abra o menu (☰) > Configurações e privacidade > Tipo de conta e ferramentas > Mudar para conta profissional e escolha Empresa.",
      },
      {
        title: "Vincule à Página do Facebook",
        detail:
          "Ainda no Instagram, toque em Editar perfil > Página e conecte a Página do Facebook da sua empresa (ou crie uma nova). A Meta exige esse vínculo para permitir publicações por outras plataformas.",
      },
      {
        title: "Conecte aqui na plataforma",
        detail:
          "Nesta página de Integrações, clique em Conectar no card do Instagram, entre com o Facebook que administra a Página e marque a Página e a conta do Instagram quando a Meta perguntar.",
      },
      {
        title: "Confirme as permissões",
        detail:
          "Na tela de autorização da Meta, mantenha marcadas as permissões de publicação e de leitura de insights. Sem elas o Hermes não consegue agendar posts nem mostrar os resultados.",
      },
    ],
    tips: ["Se a conta não aparecer na lista, confirme que ela é profissional e que está vinculada à Página correta."],
  },
  {
    provider: "facebook_page",
    name: "Página do Facebook",
    description: "Publique e agende conteúdos na Página da sua empresa no Facebook.",
    requirements: [
      "Página do Facebook da empresa.",
      "Perfil pessoal com acesso de administrador (controle total) à Página.",
    ],
    steps: [
      {
        title: "Confira o seu acesso à Página",
        detail:
          "No Facebook, abra a sua Página > Configurações > Acesso à Página. O seu perfil precisa aparecer com controle total; se não aparecer, peça a um administrador atual para conceder esse acesso.",
      },
      {
        title: "Conecte aqui na plataforma",
        detail:
          "Clique em Conectar no card da Página do Facebook nesta página de Integrações e entre com o perfil que administra a Página.",
      },
      {
        title: "Escolha as Páginas e autorize",
        detail:
          "Selecione as Páginas que a plataforma poderá gerenciar e mantenha marcadas as permissões de publicação. Você pode desmarcar Páginas que não quer conectar.",
      },
      {
        title: "Confirme a conexão",
        detail:
          "Ao voltar para a plataforma, a Página aparece como conectada no card. Se você conectou mais de uma, todas ficam disponíveis no calendário editorial.",
      },
    ],
    tips: ["Perfis pessoais não podem ser conectados: a Meta só permite publicar automaticamente em Páginas."],
  },
  {
    provider: "meta_ads",
    name: "Meta Ads (Business Manager)",
    description: "Crie campanhas no Facebook e no Instagram, use públicos personalizados e acompanhe investimento e ROAS.",
    requirements: [
      "Gerenciador de Negócios da Meta (Business Manager).",
      "Conta de anúncios com forma de pagamento ativa.",
      "Pixel da Meta instalado no site ou nas landing pages (recomendado para medir conversões).",
    ],
    steps: [
      {
        title: "Crie ou acesse o Gerenciador de Negócios",
        detail:
          "Acesse business.facebook.com e clique em Criar conta. Informe o nome da empresa, o seu nome e um e-mail comercial. Se a empresa já tem um Gerenciador, peça para ser adicionado como administrador.",
      },
      {
        title: "Adicione a conta de anúncios",
        detail:
          "Em Configurações do negócio > Contas > Contas de anúncios, clique em Adicionar e crie uma nova conta (ou adicione uma existente). Escolha o fuso horário e a moeda Real com atenção: eles não podem ser alterados depois.",
      },
      {
        title: "Cadastre a forma de pagamento",
        detail:
          "Em Configurações do negócio > Pagamentos, adicione um cartão de crédito, Pix ou boleto para a conta de anúncios. Sem pagamento ativo, as campanhas são criadas mas não são exibidas.",
      },
      {
        title: "Crie o Pixel da Meta",
        detail:
          "No Gerenciador de Eventos, clique em Conectar fontes de dados > Web > Pixel da Meta e dê um nome. Depois instale o Pixel no seu site ou use as landing pages da plataforma, que já saem preparadas para ele.",
      },
      {
        title: "Conecte aqui na plataforma",
        detail:
          "Clique em Conectar no card Meta Ads, entre com o perfil administrador do Gerenciador de Negócios e autorize a conta de anúncios e o Pixel que a plataforma vai usar.",
      },
    ],
    tips: [
      "Antes de criar uma campanha, o Hermes verifica se a conta de anúncios está ativa e com pagamento e avisa o que estiver faltando.",
    ],
  },
  {
    provider: "google_business",
    name: "Google Meu Negócio",
    description: "Publique atualizações e ofertas no Perfil da Empresa no Google (Busca e Maps).",
    requirements: [
      "Perfil da Empresa no Google verificado.",
      "Conta Google proprietária ou administradora do perfil.",
    ],
    steps: [
      {
        title: "Confira o seu perfil",
        detail:
          "Acesse business.google.com com a conta Google da empresa e verifique se o perfil aparece como verificado. Publicações automáticas só funcionam em perfis verificados.",
      },
      {
        title: "Conclua a verificação, se necessário",
        detail:
          "Se o Google pedir verificação, siga o método oferecido (vídeo, ligação, SMS, e-mail ou carta). A aprovação pode levar alguns dias; depois volte aqui para conectar.",
      },
      {
        title: "Conecte aqui na plataforma",
        detail:
          "Clique em Conectar no card Google Meu Negócio, escolha a conta Google administradora do perfil e permita que a plataforma gerencie o Perfil da Empresa.",
      },
      {
        title: "Escolha o local",
        detail:
          "Se a sua empresa tem mais de um endereço, selecione qual local a plataforma vai gerenciar. Você pode conectar outros locais depois.",
      },
    ],
    tips: ["Mantenha horário de funcionamento e telefone atualizados no perfil: isso melhora a sua posição no Google Maps."],
  },
  {
    provider: "google_calendar",
    name: "Google Calendar",
    description: "Agende reuniões com leads direto do CRM, com convite enviado automaticamente.",
    requirements: ["Conta Google com a agenda usada para as reuniões comerciais."],
    steps: [
      {
        title: "Escolha a agenda certa",
        detail:
          "Decida qual agenda vai receber as reuniões marcadas pelo CRM. Recomendamos a agenda principal da pessoa que atende os leads, para evitar conflitos de horário.",
      },
      {
        title: "Conecte aqui na plataforma",
        detail:
          "Clique em Conectar no card Google Calendar e entre com a conta Google dessa agenda.",
      },
      {
        title: "Autorize os eventos",
        detail:
          "Permita que a plataforma veja e edite eventos. É assim que o Hermes consulta horários livres, cria a reunião e envia o convite para o lead.",
      },
      {
        title: "Pronto para agendar",
        detail:
          "Ao mover um lead para Reunião Agendada no CRM, você escolhe data e horário e o evento aparece automaticamente na sua agenda do Google.",
      },
    ],
    tips: ["Você também pode pedir ao Hermes: “marque uma reunião com o lead Maria amanhã às 15h”."],
  },
  {
    provider: "telegram",
    name: "Telegram",
    description: "Converse com o Hermes pelo Telegram, por texto ou áudio, de qualquer lugar.",
    requirements: [
      "App do Telegram instalado no celular ou no computador.",
      "Cada pessoa da equipe vincula o próprio Telegram à sua conta na plataforma.",
    ],
    steps: [
      {
        title: "Gere o seu código de vínculo",
        detail:
          "Nesta página de Integrações, clique em Gerar código no card do Telegram. O código tem 8 caracteres, vale por 10 minutos e só pode ser usado uma vez.",
      },
      {
        title: "Abra o Telegram pelo botão",
        detail:
          "Toque em Abrir o Telegram e vincular, logo abaixo do código, e depois em Iniciar na conversa com o bot. O vínculo é feito automaticamente e o bot confirma na hora.",
      },
      {
        title: "Ou envie o comando manualmente",
        detail:
          "Se preferir, abra a conversa com o bot e envie /vincular seguido do seu código, por exemplo: /vincular ABCD2345. Use o botão Copiar para não errar nenhuma letra.",
      },
      {
        title: "Converse com o Hermes",
        detail:
          "Pronto! Envie seus pedidos por mensagem de texto, como “quanto do meu plano eu já usei?”. Cada mensagem usa 1 crédito de IA do plano, igual ao chat do painel. As mensagens de áudio serão liberadas em breve.",
      },
    ],
    tips: [
      "Planos Scale e White-Label podem usar um bot com o nome da própria marca: crie o bot no @BotFather com o comando /newbot, copie o token e cadastre-o nesta página. O token fica guardado com criptografia.",
    ],
  },
];

export function getIntegrationGuide(provider: IntegrationProvider): IntegrationGuide | undefined {
  return INTEGRATION_CATALOG.find((guide) => guide.provider === provider);
}
