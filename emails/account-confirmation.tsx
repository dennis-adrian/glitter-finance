import { AuthEmail } from "./_components/auth-email";

export type AccountConfirmationEmailProps = {
  confirmationUrl: string;
  siteUrl: string;
};

export function AccountConfirmationEmail({
  confirmationUrl,
  siteUrl,
}: AccountConfirmationEmailProps) {
  return (
    <AuthEmail
      preview="Un paso más para activar tu cuenta de Billetera Ferial."
      siteUrl={siteUrl}
      heading="Confirmá tu correo"
      copy="Confirmá esta dirección para terminar de crear tu cuenta y empezar a registrar tus ventas."
      actionLabel="Confirmar mi correo"
      actionUrl={confirmationUrl}
      finePrint="Si no creaste esta cuenta, podés ignorar este mensaje."
    />
  );
}

AccountConfirmationEmail.PreviewProps = {
  confirmationUrl:
    "http://localhost:3000/auth/confirm?token_hash=preview&type=email&next=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcallback",
  siteUrl: "http://localhost:3000",
} satisfies AccountConfirmationEmailProps;

export default AccountConfirmationEmail;
