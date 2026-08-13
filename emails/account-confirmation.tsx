import type { CSSProperties } from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from "react-email";

export type AccountConfirmationEmailProps = {
  confirmationUrl: string;
  siteUrl: string;
};

export function AccountConfirmationEmail({
  confirmationUrl,
  siteUrl,
}: AccountConfirmationEmailProps) {
  return (
    <Html lang="es">
      <Head />
      <Preview>Un paso más para activar tu cuenta de Billetera Ferial.</Preview>
      <Body style={body}>
        <Container style={shell}>
          <Section style={brandRow}>
            <Img
              src={`${siteUrl.replace(/\/$/, "")}/icons/icon-192.png`}
              width="40"
              height="40"
              alt=""
              style={logo}
            />
            <Text style={brandName}>Billetera Ferial</Text>
          </Section>

          <Section style={card}>
            <Section style={coralMark} />
            <Heading style={heading}>Confirmá tu correo</Heading>
            <Text style={copy}>
              Confirmá esta dirección para terminar de crear tu cuenta y empezar
              a registrar tus ventas.
            </Text>

            <Button href={confirmationUrl} style={button}>
              Confirmar mi correo
            </Button>

            <Hr style={divider} />
            <Text style={finePrint}>
              Si no creaste esta cuenta, podés ignorar este mensaje.
            </Text>
          </Section>

          <Text style={footer}>
            Este mensaje fue enviado automáticamente por Billetera Ferial.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

AccountConfirmationEmail.PreviewProps = {
  confirmationUrl: "https://example.com/auth/confirm",
  siteUrl: "http://localhost:3000",
} satisfies AccountConfirmationEmailProps;

export default AccountConfirmationEmail;

const body: CSSProperties = {
  margin: 0,
  backgroundColor: "#f2f0eb",
  fontFamily:
    "Instrument Sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
};

const shell: CSSProperties = {
  width: "100%",
  maxWidth: "560px",
  margin: "0 auto",
  padding: "40px 16px",
};

const brandRow: CSSProperties = {
  padding: "0 0 18px",
};

const logo: CSSProperties = {
  display: "inline-block",
  verticalAlign: "middle",
  width: "40px",
  height: "40px",
  marginRight: "10px",
};

const brandName: CSSProperties = {
  display: "inline-block",
  verticalAlign: "middle",
  margin: 0,
  color: "#1a2e2c",
  fontSize: "18px",
  lineHeight: "22px",
  fontWeight: 700,
};

const card: CSSProperties = {
  padding: "44px 48px",
  border: "1px solid #e2dcd5",
  borderRadius: "24px",
  backgroundColor: "#fffdf8",
  boxShadow: "0 12px 32px rgba(26, 46, 44, 0.08)",
};

const coralMark: CSSProperties = {
  width: "48px",
  height: "6px",
  margin: "0 0 28px",
  borderRadius: "999px",
  backgroundColor: "#e8725a",
};

const heading: CSSProperties = {
  margin: "0 0 16px",
  color: "#1a2e2c",
  fontFamily:
    "Bricolage Grotesque, Instrument Sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
  fontSize: "32px",
  lineHeight: "38px",
  fontWeight: 800,
  letterSpacing: "-0.5px",
};

const copy: CSSProperties = {
  margin: "0 0 28px",
  color: "#5a6b68",
  fontSize: "16px",
  lineHeight: "24px",
};

const button: CSSProperties = {
  display: "block",
  padding: "16px 28px",
  borderRadius: "16px",
  backgroundColor: "#00786f",
  color: "#ffffff",
  fontSize: "16px",
  lineHeight: "20px",
  fontWeight: 700,
  textAlign: "center",
  textDecoration: "none",
};

const divider: CSSProperties = {
  margin: "28px 0 22px",
  borderColor: "#e2dcd5",
};

const finePrint: CSSProperties = {
  margin: 0,
  color: "#7a7571",
  fontSize: "13px",
  lineHeight: "20px",
};

const footer: CSSProperties = {
  margin: "20px 24px 0",
  color: "#7a7571",
  fontSize: "12px",
  lineHeight: "18px",
  textAlign: "center",
};
