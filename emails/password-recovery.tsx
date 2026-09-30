import { AuthEmail } from "./_components/auth-email";

export type PasswordRecoveryEmailProps = {
  recoveryUrl: string;
  siteUrl: string;
};

export function PasswordRecoveryEmail({
  recoveryUrl,
  siteUrl,
}: PasswordRecoveryEmailProps) {
  return (
    <AuthEmail
      preview="Creá una contraseña nueva para tu cuenta de Billetera Ferial."
      siteUrl={siteUrl}
      heading="Creá una contraseña nueva"
      copy="Recibimos un pedido para cambiar la contraseña de tu cuenta. Tocá el botón para elegir una nueva."
      actionLabel="Crear contraseña nueva"
      actionUrl={recoveryUrl}
      finePrint="Si no pediste este cambio, podés ignorar este mensaje: tu contraseña sigue siendo la misma."
    />
  );
}

PasswordRecoveryEmail.PreviewProps = {
  recoveryUrl:
    "http://localhost:3000/auth/confirm?token_hash=preview&type=recovery&next=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcallback%3Fnext%3D%252Fauth%252Fupdate-password",
  siteUrl: "http://localhost:3000",
} satisfies PasswordRecoveryEmailProps;

export default PasswordRecoveryEmail;
