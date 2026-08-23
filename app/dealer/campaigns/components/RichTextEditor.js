"use client";
import { useRef, useEffect, useState, useCallback } from "react";
import { Editor } from "@tinymce/tinymce-react";
import { Button, Tabs, Tab } from "react-bootstrap";

export default function RichTextEditor({ value, onChange, placeholder, disabled = false }) {
  const editorRef = useRef(null);
  const [isMounted, setIsMounted] = useState(false);
  const [viewMode, setViewMode] = useState("normal"); // 'normal', 'html', 'preview'
  const [wordCount, setWordCount] = useState({ words: 0, characters: 0 });

  // Ensure component is mounted (client-side only)
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Calculate word and character count
  useEffect(() => {
    if (value) {
      const text = value.replace(/<[^>]*>/g, ""); // Strip HTML tags
      const words = text.trim() ? text.trim().split(/\s+/).filter(word => word.length > 0) : [];
      setWordCount({
        words: words.length,
        characters: text.length
      });
    } else {
      setWordCount({ words: 0, characters: 0 });
    }
  }, [value]);

  const handleEditorChange = useCallback((content, editor) => {
    onChange(content);
  }, [onChange]);

  const handleViewModeChange = (mode) => {
    setViewMode(mode);
  };

  const getHtmlContent = () => {
    return value || "";
  };

  const getPreviewContent = () => {
    return { __html: value || "" };
  };

  // Don't render until mounted (client-side only)
  if (!isMounted) {
    return (
      <div className="rich-text-editor" style={{ minHeight: "200px", backgroundColor: "#fff" }}>
        <div className="d-flex align-items-center justify-content-center" style={{ minHeight: "200px" }}>
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading editor...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rich-text-editor">
      {viewMode === "normal" && (
        <div>
          <Editor
            apiKey={process.env.NEXT_PUBLIC_TINYMCE_API_KEY || "no-api-key"}
            onInit={(evt, editor) => editorRef.current = editor}
            value={value || ""}
            onEditorChange={handleEditorChange}
            disabled={disabled}
            init={{
              height: 500,
              menubar: true,
              plugins: [
                'advlist', 'autolink', 'lists', 'link', 'image', 'charmap', 'preview',
                'anchor', 'searchreplace', 'visualblocks', 'code', 'fullscreen',
                'insertdatetime', 'media', 'table', 'code', 'help', 'wordcount',
                'template', 'paste', 'textcolor', 'colorpicker', 'textpattern', 'imagetools'
              ],
              toolbar: 'undo redo | blocks | ' +
                'bold italic forecolor | alignleft aligncenter ' +
                'alignright alignjustify | bullist numlist outdent indent | ' +
                'removeformat | link image | youtube vimeo | table emailtable | code preview | help',
              content_style: 'body { font-family: Arial, sans-serif; font-size: 14px; }',
              placeholder: placeholder || "Start typing...",
              // Table configuration
              table_toolbar: 'tableprops tabledelete | tableinsertrowbefore tableinsertrowafter tabledeleterow | tableinsertcolbefore tableinsertcolafter tabledeletecol',
              table_resize_bars: true,
              table_default_attributes: {
                border: '1',
                cellpadding: '8',
                cellspacing: '0'
              },
              table_default_styles: {
                'border-collapse': 'collapse',
                'width': '100%',
                'margin': '10px 0'
              },
              // Paste configuration for email HTML
              paste_as_text: false,
              paste_auto_cleanup_on_paste: true,
              paste_remove_styles: false,
              paste_remove_spans: false,
              paste_strip_class_attributes: 'none',
              paste_retain_style_properties: 'all',
              // Allow all HTML for email templates
              valid_elements: '*[*]',
              extended_valid_elements: '*[*]',
              // Remove invalid elements warning
              invalid_elements: '',
              // Allow table attributes
              table_class_list: [
                { title: 'None', value: '' },
                { title: 'Table', value: 'table' }
              ],
              // Image configuration
              image_advtab: true,
              image_title: true,
              image_description: false,
              image_dimensions: true,
              image_class_list: [
                { title: 'None', value: '' },
                { title: 'Responsive', value: 'img-responsive' }
              ],
              // Image upload handler (you can customize this)
              images_upload_handler: async (blobInfo, progress) => {
                // For now, return data URL - you can implement actual upload later
                return new Promise((resolve) => {
                  const reader = new FileReader();
                  reader.onload = () => {
                    resolve(reader.result);
                  };
                  reader.onerror = () => {
                    resolve('');
                  };
                  reader.readAsDataURL(blobInfo.blob());
                });
              },
              // Link configuration
              link_title: true,
              link_target_list: [
                { title: 'None', value: '' },
                { title: 'New window', value: '_blank' },
                { title: 'Same window', value: '_self' }
              ],
              link_assume_external_targets: true,
              link_context_toolbar: true,
              // Video/Media configuration
              media_live_embeds: true,
              video_template_callback: (data) => {
                return `<video width="${data.width || 560}" height="${data.height || 315}" controls>
                  <source src="${data.source1}" type="video/mp4">
                  Your browser does not support the video tag.
                </video>`;
              },
              // Email template specific settings
              convert_urls: false,
              relative_urls: false,
              remove_script_host: false,
              // Code view
              code_dialog_width: 800,
              code_dialog_height: 600,
              // Word count
              wordcount_countregex: /[\w\u2019\'-]+/g,
              // Templates (optional - for email templates)
              templates: [
                {
                  title: 'Email Template - Basic',
                  description: 'Basic email template with table structure',
                  content: `
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
                      <tr>
                        <td style="padding: 20px; text-align: center; background-color: #007bff; color: #ffffff;">
                          <h1>Email Header</h1>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 20px;">
                          <p>Hello,</p>
                          <p>This is your email content.</p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 20px; text-align: center; background-color: #f8f9fa; color: #6c757d; font-size: 12px;">
                          <p>&copy; 2026 Your Company</p>
                        </td>
                      </tr>
                    </table>
                  `
                }
              ],
              // Setup callback for additional configuration
              setup: (editor) => {
                // Add custom button for inserting email table
                editor.ui.registry.addButton('emailtable', {
                  text: 'Email Table',
                  tooltip: 'Insert email table structure',
                  onAction: () => {
                    const tableHtml = `
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse; width: 100%; margin: 10px 0;">
                        <tbody>
                          <tr>
                            <td style="border: 1px solid #ddd; padding: 8px; min-width: 100px; vertical-align: top;">&nbsp;</td>
                            <td style="border: 1px solid #ddd; padding: 8px; min-width: 100px; vertical-align: top;">&nbsp;</td>
                            <td style="border: 1px solid #ddd; padding: 8px; min-width: 100px; vertical-align: top;">&nbsp;</td>
                          </tr>
                          <tr>
                            <td style="border: 1px solid #ddd; padding: 8px; min-width: 100px; vertical-align: top;">&nbsp;</td>
                            <td style="border: 1px solid #ddd; padding: 8px; min-width: 100px; vertical-align: top;">&nbsp;</td>
                            <td style="border: 1px solid #ddd; padding: 8px; min-width: 100px; vertical-align: top;">&nbsp;</td>
                          </tr>
                        </tbody>
                      </table>
                    `;
                    editor.insertContent(tableHtml);
                  }
                });

                // Add custom button for YouTube/Vimeo video
                editor.ui.registry.addButton('youtube', {
                  text: 'YouTube',
                  tooltip: 'Insert YouTube video',
                  onAction: () => {
                    const url = prompt('Enter YouTube URL:');
                    if (url) {
                      let videoId = '';
                      if (url.includes('youtube.com/watch?v=')) {
                        videoId = url.split('v=')[1].split('&')[0];
                      } else if (url.includes('youtu.be/')) {
                        videoId = url.split('youtu.be/')[1].split('?')[0];
                      }
                      if (videoId) {
                        const embedHtml = `<iframe width="560" height="315" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
                        editor.insertContent(embedHtml);
                      } else {
                        alert('Invalid YouTube URL');
                      }
                    }
                  }
                });

                // Add custom button for Vimeo video
                editor.ui.registry.addButton('vimeo', {
                  text: 'Vimeo',
                  tooltip: 'Insert Vimeo video',
                  onAction: () => {
                    const url = prompt('Enter Vimeo URL:');
                    if (url) {
                      const videoIdMatch = url.match(/vimeo\.com\/(\d+)/);
                      if (videoIdMatch) {
                        const videoId = videoIdMatch[1];
                        const embedHtml = `<iframe src="https://player.vimeo.com/video/${videoId}" width="560" height="315" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
                        editor.insertContent(embedHtml);
                      } else {
                        alert('Invalid Vimeo URL');
                      }
                    }
                  }
                });
              }
            }}
          />
        </div>
      )}
      
      {viewMode === "html" && (
        <textarea
          className="form-control"
          value={getHtmlContent()}
          onChange={(e) => onChange(e.target.value)}
          readOnly={disabled}
          style={{
            minHeight: "500px",
            fontFamily: "monospace",
            fontSize: "12px",
          }}
        />
      )}
      
      {viewMode === "preview" && (
        <div
          className="ql-editor"
          dangerouslySetInnerHTML={getPreviewContent()}
          style={{
            minHeight: "500px",
            border: "1px solid #ccc",
            borderRadius: "4px",
            padding: "12px",
            backgroundColor: "#fff",
          }}
        />
      )}

      {/* View Mode Tabs and Action Buttons */}
      <div className="d-md-flex justify-content-between align-items-center mt-2">
        <div className="d-flex gap-md-2 gap-1 align-items-center mb-md-0 mb-1 flex-wrap">
          <div className="d-flex gap-md-2 gap-1">
            <Button
              variant={viewMode === "normal" ? "custom" : "outline-secondary"}
              size="sm"
              onClick={() => handleViewModeChange("normal")}
              disabled={disabled}
            >
              Normal
            </Button>
            <Button
              variant={viewMode === "html" ? "custom" : "outline-secondary"}
              size="sm"
              onClick={() => handleViewModeChange("html")}
              disabled={disabled}
            >
              HTML
            </Button>
            <Button
              variant={viewMode === "preview" ? "custom" : "outline-secondary"}
              size="sm"
              onClick={() => handleViewModeChange("preview")}
              disabled={disabled}
            >
              Preview
            </Button>
          </div>
        </div>
        <div className="text-muted small">
          {wordCount.words} words, {wordCount.characters} characters
        </div>
      </div>
    </div>
  );
}
