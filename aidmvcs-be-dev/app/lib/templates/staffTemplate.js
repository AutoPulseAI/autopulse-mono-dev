import { baseTemplate } from './baseTemplate.js';

export const staffTemplate = (staffData) => {
  const { 
    name, 
    email, 
    password, 
    type, 
    createdBy, 
    loginUrl = 'https://your-app-url.com/login',
    supportEmail = 'support@yourcompany.com'
  } = staffData;
  const baseurl = `${process.env.NEXT_PUBLIC_BASE_URL}`;
  console.log('createdBy',createdBy);
  // Customize content based on staff type
  const getRoleSpecificContent = () => {
    switch(type.toLowerCase()) {
      case 'admin':
        return {
          title: `Your Account Has Been Created – Welcome to the Team!`,
          acctype: '',
          description: `
            <tr>
              <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
                <div class="links-1A73E8-bold">
                  <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                    <p style="margin:0 0">Welcome aboard!</p>
                  </div>
                </div>
              </td>
            </tr>
          `,
          instructions: `
            <tr>
              <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
                <div class="links-1A73E8-bold">
                  <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                    <p style="margin:0 0">Your account has been successfully created by the admin. You can now log in and begin using the platform to manage your tasks and support the dealership's operations.</p>
                  </div>
                </div>
              </td>
            </tr>
          `,
          description2: `
            <tr>
              <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
                <div class="links-1A73E8-bold">
                  <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                    <p style="margin:0 0">Please log in and change your password after your first login for security purposes.</p>
                  </div>
                </div>
              </td>
            </tr>
            <tr>
              <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
                <div class="links-1A73E8-bold">
                  <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                    <p style="margin:0 0">If you have any questions or need assistance getting started, feel free to reach out to me directly.</p>
                  </div>
                </div>
              </td>
            </tr>
            <tr>
              <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
                <div class="links-1A73E8-bold">
                  <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                    <p style="margin:0 0">Looking forward to working together!</p>
                  </div>
                </div>
              </td>
            </tr>
            <tr>
              <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
                <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                    <p style="margin:0 0">Best regards,</p>
                    <p style="margin:0 0"><b>${baseurl}</b></p>

                    <p style="margin:0 0"><a href="${baseurl}" target="_blank" style="text-decoration:none;color:#0272b4;">${baseurl}</a></p>
                  </div>
              </td>
            </tr>
          `
        };
      case 'dealer':
        return {
          title: `Welcome to Autopulse.AI - Your Dealership Account is Ready!`,
          acctype: `dealer`,
          description: `
            <tr>
              <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
                <div class="links-1A73E8-bold">
                  <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                    <p style="margin:0 0">We’re excited to welcome you to <b> Autopulse.AI !</b></p>
                  </div>
                </div>
              </td>
            </tr>
          `,
          instructions: `
            <tr>
              <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
                <div class="links-1A73E8-bold">
                  <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                    <p style="margin:0 0">Your dealership account has been successfully created on our platform powered by Autopulse.AI. Below are your login details to access your dashboard and start managing your leads and operations more efficiently.</p>
                  </div>
                </div>
              </td>
            </tr>
          `,
          description2: `
            <tr>
              <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
                <div class="links-1A73E8-bold">
                  <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                    <p style="margin:0 0">Please change your password after your first login to keep your account secure.</p>
                  </div>
                </div>
              </td>
            </tr>
            <tr>
              <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
                <div class="links-1A73E8-bold">
                  <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                    <p style="margin:0 0">If you need any help getting started or have questions, feel free to reach out to our team at <a href="mailto:" style="text-decoration:none;color:#0272b4;"> ${createdBy ? `${createdBy.email}`:`support@autopulse.a`}</a>.</p>
                  </div>
                </div>
              </td>
            </tr>
            <tr>
              <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
                <div class="links-1A73E8-bold">
                  <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                    <p style="margin:0 0">We’re here to help you succeed and look forward to working together.</p>
                  </div>
                </div>
              </td>
            </tr>
            <tr>
              <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
                <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                    <p style="margin:0 0">Best regards,</p>
                    <p style="margin:0 0"><b>Autopulse.AI</b></p>
                    ${createdBy ? `
                      <p style="margin:0 0"><a href="mailto:${createdBy.email}" style="text-decoration:none;color:#0272b4;">${createdBy.email}</a></p>
                    
                    ${createdBy.phone ? `<p style="margin:0 0"><a href="tel:${createdBy.phone}" style="text-decoration:none;color:#0272b4;">${createdBy.phone}</a></p>`:''}
                     ${createdBy.website ? ` <p style="margin:0 0"><a href="${createdBy.website}" style="text-decoration:none;color:#0272b4;">${createdBy.website}</a></p>`:''}
                   
                    ` : `
                      <p style="margin:0 0"><a href="mailto:support@autopulse.ai" style="text-decoration:none;color:#0272b4;">support@autopulse.ai</a></p>
                     
                    `}
                  </div>
              </td>
            </tr>
          `
        };
      case 'vendor':
        return {
          title: `Your Account Has Been Created – Welcome to Autopulse.AI`,
          acctype: `agency`,
          description: `
            <tr>
              <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
                <div class="links-1A73E8-bold">
                  <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                    <p style="margin:0 0">Welcome to <b>Autopulse.AI!</b></p>
                  </div>
                </div>
              </td>
            </tr>
          `,
          instructions: `
            <tr>
              <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
                <div class="links-1A73E8-bold">
                  <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                    <p style="margin:0 0">Your account has been successfully created. You can now log in and start using the platform to support our dealerships and operations.</p>
                  </div>
                </div>
              </td>
            </tr>
          `,
          description2: `
            <tr>
              <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
                <div class="links-1A73E8-bold">
                  <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                    <p style="margin:0 0">Please log in using the above credentials and update your password for security.</p>
                  </div>
                </div>
              </td>
            </tr>
            <tr>
              <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
                <div class="links-1A73E8-bold">
                  <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                    <p style="margin:0 0">If you have any questions or need help getting started, feel free to reach out to your team lead or contact us directly at ${createdBy ? `${createdBy.email}`:`support@autopulse.ai`}.</p>
                  </div>
                </div>
              </td>
            </tr>
            <tr>
              <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
                <div class="links-1A73E8-bold">
                  <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                    <p style="margin:0 0">We’re excited to have you on the team!</p>
                  </div>
                </div>
              </td>
            </tr>
            <tr>
              <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
                <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
                    <p style="margin:0 0">Best regards,</p>
                    <p style="margin:0 0"><b>Autopulse.AI</b></p>
                    ${createdBy ? `
                      <p style="margin:0 0"><a href="mailto:${createdBy.email}" style="text-decoration:none;color:#0272b4;">${createdBy.email}</a></p>
                       <p style="margin:0 0"><a href="tel:${createdBy.phone}" style="text-decoration:none;color:#0272b4;">${createdBy.phone}</a></p>
                    <p style="margin:0 0"><a href="${createdBy.website}" style="text-decoration:none;color:#0272b4;">${createdBy.website}</a></p>
                     
                    ` : `
                      <p style="margin:0 0"><a href="mailto:support@autopulse.ai" style="text-decoration:none;color:#0272b4;">support@autopulse.ai</a></p>
                     
                    `}
                  
                  </div>
              </td>
            </tr>
          `
        };
      default:
        return {
          title: 'Your Staff Account Has Been Created',
          description: `
            <p>Your staff account has been created by ${createdBy || 'Autopulse.AI'}.</p>
           
          `,
          instructions: `
            <p>Please use the credentials below to access the system:</p>
          `
        };
    }
  };

  const roleContent = getRoleSpecificContent();
  const acctype = roleContent.acctype || '';

  const content = `
    <tr>
      <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left;">
        <div class="links-1A73E8-bold">
          <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
            <p style="margin:0 0">Hi ${name || 'there'},</p>
          </div>
        </div>
      </td>
    </tr>
    
    ${roleContent.description}
    
    ${roleContent.instructions}
    
    <tr>
      <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
        <div class="links-1A73E8-bold">
          <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:18px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
            <p style="margin:0 0"><b>Login Credentials</b></p>
          </div>
        </div>
      </td>
    </tr>
    <tr>
      <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 25px 8px 25px;word-break:break-word;text-align:left">
        <div class="links-1A73E8-bold">
          <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:#3c4043">
            <p style="margin:0 0 5px 0"><b>Username: </b><a style="text-decoration:none;color:#0272b4;">${email}</a></p>
            <p style="margin:0 0 5px 0"><b>Password: </b>${password}</p>
            <p style="margin:0 0 0"><b>Login Link:</b> <a href="${process.env.NEXT_PUBLIC_BASE_URL}/${acctype}" target="_blank" style="text-decoration:none;color:#0272b4;">${process.env.NEXT_PUBLIC_BASE_URL}/${acctype}</a>.</p>
          </div>
        </div>
      </td>
    </tr>

    ${roleContent.description2}
    
  `;

  const button = {
    text: 'Login to Your Account',
    url: loginUrl
  };

  return {
    subject: roleContent.title,
    html: baseTemplate(content, roleContent.title, button)
  };
};