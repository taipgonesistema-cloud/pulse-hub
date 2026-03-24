export type CreateWhatsappSessionDto = {
  name: string;
  phoneNumber: string;
  channelName: string;
};

export type SendConversationMessageDto = {
  body: string;
  author?: string;
};
