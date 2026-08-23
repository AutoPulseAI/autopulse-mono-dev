export const subscriptionActivatedTemplate = (name, subscription, packageDetails, user) => {
  // Set the login URL based on user type
  const loginUrl = user?.type === 'vendor' 
    ? `${process.env.NEXT_PUBLIC_BASE_URL}/vendor/login`
    : `${process.env.NEXT_PUBLIC_BASE_URL}/dealer/login`;

  return {
  subject: 'Your Autopulse.AI Subscription Has Been Activated',
  html: `
      <!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Your autopulse.ai Subscription Has Been Activated</title>

<style>
 body{
    margin:0;
    padding:0
}
.mail_parent table{
    border-spacing:0
}
.mail_parent img{
    border:0;
    height:auto;
    line-height:100%;
    outline:none;
    text-decoration:none
}
.mail_parent p{
    display:block;
    margin:13px 0
}
@media only screen and (min-width:950px){
    .mail_parent .column-100{
        width:100%!important;
        max-width:100%
    }
    .mail_parent .column-50{
        width:50%!important;
        max-width:50%
    }
}
.mail_parent u~div .img-container img+div{
    display:none
}
.mail_parent .links-0068A5-underline a{
    color:#0068a5;
    text-decoration:underline
}
.mail_parent .links-1A73E8-bold a{
    color:#1a73e8;
    text-decoration:none;
    font-weight:bold
}
.mail_parent .links-1A73E8-underline a{
    color:#1a73e8;
    text-decoration:underline
}
.mail_parent .links-1967D2-underline a{
    color:#1967d2;
    text-decoration:underline
}
@media only screen and (min-width:950px){
    .mail_parent .padding-0px-90px-8px-90px{
        padding:0px 90px 8px 90px!important
    }
    .mail_parent .padding-8px-75px-8px-75px{
        padding:8px 75px 8px 75px!important
    }
    .mail_parent .padding-8px-25px-0px-25px{
        padding:8px 25px 0px 25px!important
    }
    .mail_parent .padding-0px-40px-20px-40px{
        padding:0px 40px 20px 40px!important
    }
    .mail_parent .padding-10px-20px-0px-0px{
        padding:10px 20px 0px 0px!important
    }
    .mail_parent .margin-0-auto-0-0{
        margin:0 auto 0 0!important
    }
    .mail_parent .img-full-width{
        max-width:100%!important
    }
    .mail_parent .text-align-left{
        text-align:left!important
    }
    .mail_parent .padding-10px-0px-10px-0px{
        padding:10px 0px 10px 0px!important
    }
    .mail_parent .padding-0px-0px-10px-0px{
        padding:0px 0px 10px 0px!important
    }
    .mail_parent .padding-0px-20px-0px-0px{
        padding:0px 20px 0px 0px!important
    }
    .mail_parent .padding-8px-10px-20px-10px{
        padding:8px 10px 20px 10px!important
    }
    .mail_parent .padding-32px-30px-25px-30px{
        padding:32px 30px 25px 30px!important
    }
    .mail_parent .padding-10px-65px-10px-65px{
        padding:10px 65px 10px 65px!important
    }
}
.mail_parent p{
    margin:0 0
}
.mail_parent ul{
    display:block
}
.mail_parent sup,.mail_parent sub{
    line-height:0
}
.mail_parent body a{
    text-decoration:none;
    color:#0068a5
}
.mail_parent .image-highlight{
}
.mail_parent .image-highlight:hover{
}
.mail_parent .button-highlight{
}
.mail_parent .button-highlight:hover{
}
@media only screen and (min-width:950px){
    .mail_parent .hide-on-mobile{
        display:block!important
    }
    .mail_parent .hide-on-desktop{
        display:none!important
    }
}
.mail_parent .hide-on-desktop{
    display:block
}
.mail_parent .hide-on-mobile{
    display:none
}
.mail_parent [class~="x_body"]{
    width:99.9%
}
</style>

</head>
<body>
<div style="background-color:#f1f3f4;background-position:center center;background-size:auto;background-repeat:repeat" class="mail_parent">
  <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%">
    <tbody>
      <tr>
        <td align="center">
          <div style="Margin:0px auto;border-radius:0;max-width:600px">
            <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;border-radius:0">
              <tbody>
                <tr>
                  <td style="border-radius:0;font-size:0px;padding:0px;text-align:center;vertical-align:top">
                    <div class="column-100" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%">
                      <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-radius:0px;vertical-align:top" width="100%">
                        <tbody>
                          <tr>
                            <td style="font-size:0px;padding:0 0 0 0;word-break:break-word">
                              <div style="line-height:32px;height:32px">&nbsp;</div>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </td>
      </tr>
    </tbody>
  </table>
  <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:transparent;width:100%">
    <tbody>
      <tr>
        <td align="center">
          <div role="presentation">
            <div style="background:#ffffff;background-color:#ffffff;Margin:0px auto;border-radius:0 0 0px 0px;max-width:600px">
              <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#ffffff;width:100%;border-radius:12px 12px 0px 0px">
                <tbody>
                  <tr>
                    <td style="border-radius:12px 12px 0px 0px;font-size:0px;padding:0px 0px 0px 0px;text-align:center;vertical-align:top">
                      <div class="column-100" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%">
                        <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-radius:0px;vertical-align:top" width="100%">
                          <tbody>
                            <tr>
                              <td class="img-container" style="font-size:0px;padding:32px 25px 24px 25px;word-break:break-word;text-align:center">
                                <div style="margin:0 auto;max-width:170px">
                                  <img alt="Logo" height="auto" width="170" src="https://www.autopulse.ai/Images/logo.png" style="border:none;outline:none;text-decoration:none;height:auto;width:100%;font-size:13px;display:block" class="CToWUd" tabindex="0">
                                </div>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </td>
      </tr>
    </tbody>
  </table>
  <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:transparent;width:100%">
    <tbody>
      <tr>
        <td align="center">
          <div style="background:#ffffff;background-color:#ffffff;Margin:0px auto;max-width:600px">
            <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#ffffff;width:100%;">
              <tbody>
                <tr>
                  <td style="font-size:0px;padding:0px 0px 24px 0px;text-align:center;vertical-align:top">
                    <div class="column-100" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%">
                      <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
                        <tbody>
                          <tr>
                            <td style="background-color:transparent;border-radius:0px;vertical-align:top;padding:5px 0px 5px 0px">
                              <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
                                <tbody>
                                  <tr>
                                    <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left;">
                                      <div class="links-1A73E8-bold">
                                        <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                          <p style="margin:0 0">Hi ${name || 'there'},</p>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                  <tr>
                                    <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
                                      <div class="links-1A73E8-bold">
                                        <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                          <p style="margin:0 0">We're pleased to inform you that your <b>autopulse.ai subscription</b> has been successfully activated.</p>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                  <tr>
                                    <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
                                      <div class="links-1A73E8-bold">
                                        <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                          <p style="margin:0 0">Below are the details of your current subscription:</p>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                  <tr>
                                    <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
                                      <div class="links-1A73E8-bold">
                                        <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:18px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                          <p style="margin:0 0"><b>Subscription Details</b></p>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                  
                                  <tr>
                                    <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
                                      <div class="links-1A73E8-bold">
                                        <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                          <p style="margin:0 0 5px 0"><b>Subscription Type:</b> ${packageDetails?.name || 'Vendor Package'}</p>
                                          <p style="margin:0 0 5px 0"><b>Billing Interval:</b> ${packageDetails?.billing_interval === 'month' ? 'Monthly' : 'Yearly'}</p>
                                          ${user?.type === 'vendor' ? `
                                            <p style="margin:0 0 5px 0"><b>Number of Stores Assigned:</b> ${user.package_dealers_used ?? 0}</p>
                                            
                                          ` : ''}
                                          <p style="margin:0 0 5px 0"><b>Price:</b> $${subscription.price }</p>
                                          <p style="margin:0 0 5px 0"><b>Start Date:</b> ${new Date(subscription?.start_date || Date.now()).toLocaleDateString()}</p>
                                          <p style="margin:0 0 0"><b>Next Renewal Date:</b> ${new Date(subscription?.end_date || new Date().setMonth(new Date().getMonth() + 1)).toLocaleDateString()}</p>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                  <tr>
                                    <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
                                      <div class="links-1A73E8-bold">
                                        <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                          <p style="margin:0 0">You can now log in and begin managing your dealership network with AI-powered tools built to scale performance, optimize lead workflows, and streamline communications.</p>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                  <tr>
                                    <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
                                      <div class="links-1A73E8-bold">
                                        <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                          <p style="margin:0 0 0"><b>Access your account here:</b> <a href="${process.env.NEXT_PUBLIC_BASE_URL}/agency" target="_blank" style="text-decoration:none;color:#0272b4;">Login</a>.</p>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                  
                                  <tr>
                                    <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
                                      <div class="links-1A73E8-bold">
                                        <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                          <p style="margin:0 0">If you need assistance or wish to modify your subscription, feel free to contact us at <a href="mailto:support@autopluse.ai" style="text-decoration:none;color:#0272b4;">support@autopluse.ai</a>.</p>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                  <tr>
                                    <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
                                      <div class="links-1A73E8-bold">
                                        <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                          <p style="margin:0 0">Thank you for choosing Autopluse.AI – we're excited to be your partner in growth!</p>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                  <tr>
                                    <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
                                      <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                                          <p style="margin:0 0">Best regards,</p>
                                          <p style="margin:0 0"><b>The Autopluse.ai Team</b></p>
                                          <p style="margin:0 0"><a href="http://www.autopluse.ai/" target="_blank" style="text-decoration:none;color:#0272b4;">www.autopluse.ai</a>&nbsp;|&nbsp;<a href="mailto:support@autopluse.ai" style="text-decoration:none;color:#0272b4;">support@autopluse.ai</a></p>
                                        </div>
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </td>
      </tr>
    </tbody>
  </table>
  
  <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%">
    <tbody>
      <tr>
        <td align="center">
          <div style="background:transparent;background-color:transparent;Margin:0px auto;border-radius:0;max-width:600px">
            <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:transparent;width:100%;border-radius:0">
              <tbody>
                <tr>
                  <td style="border-radius:0;font-size:0px;padding:20px 0px 60px 0px;text-align:center;vertical-align:top">
                    <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
                      <tbody>
                        <tr>
                          <td style="background-color:transparent;line-height:0;font-size:0;direction:ltr;border-radius:0px">
                            <div class="column-100" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%">
                              <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-radius:0px;vertical-align:top" width="100%">
                                <tbody>
                                  <tr>
                                    <td class="padding-10px-65px-10px-65px" style="font-size:0px;padding:10px 25px 10px 25px;word-break:break-word;text-align:center">
                                      <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:12px;letter-spacing:0px;line-height:1.4;text-align:center;color:#5f6368">
                                        <p style="margin:0 0">© ${new Date().getFullYear()} Autopulse.ai</p>
                                        <p style="margin:0 0">&nbsp;</p>
                                        <p style="margin:0 0">You are receiving this email because you registered on Autopluse.ai.</p>
                                      </div>
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </td>
      </tr>
    </tbody>
  </table>
</div>
</body>
</html>
    `,
  };
};