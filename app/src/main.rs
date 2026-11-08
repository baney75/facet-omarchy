use adw::prelude::*;
use gtk::{gdk, gio, glib};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;
use std::time::Instant;
use webkit6::prelude::*;
use {libadwaita as adw, gtk4 as gtk};

const APP_ID: &str = "app.panes.browser";
const HOME_URL: &str = "https://duckduckgo.com/";

#[derive(Serialize, Deserialize, Default)]
struct SavedSpace {
    name: String,
    urls: Vec<String>,
}

#[derive(Serialize, Deserialize, Default)]
struct Session {
    active: usize,
    spaces: Vec<SavedSpace>,
}

struct Tab {
    view: webkit6::WebView,
    row: gtk::ListBoxRow,
    // Restored tabs hold their URL here and load only when first shown.
    pending: RefCell<Option<String>>,
}

struct Space {
    name: String,
    list: gtk::ListBox,
    tabs: Vec<Tab>,
}

struct Browser {
    window: adw::ApplicationWindow,
    pages: gtk::Stack,
    lists: gtk::Stack,
    switcher: gtk::Box,
    address: gtk::Entry,
    network: webkit6::NetworkSession,
    spaces: RefCell<Vec<Space>>,
    active: RefCell<usize>,
    next_id: RefCell<u64>,
    started: Instant,
    smoke: RefCell<bool>,
}

fn data_dir() -> PathBuf {
    glib::user_data_dir().join("facet")
}

fn session_path() -> PathBuf {
    data_dir().join("session.json")
}

/// Turns address bar input into a URL, treating anything that isn't address-shaped as a search.
fn resolve_input(input: &str) -> String {
    let text = input.trim();
    let has_scheme = text.contains("://") || text.starts_with("about:");
    let looks_like_host = !text.contains(' ') && (text.contains('.') || text.starts_with("localhost"));
    if has_scheme {
        text.to_string()
    } else if looks_like_host {
        format!("https://{text}")
    } else {
        format!("https://duckduckgo.com/?q={}", glib::Uri::escape_string(text, None, false))
    }
}

impl Tab {
    fn url(&self) -> Option<String> {
        self.pending.borrow().clone().or_else(|| self.view.uri().map(|u| u.to_string()))
    }
}

impl Browser {
    fn load_if_pending(&self, row: &gtk::ListBoxRow) {
        let spaces = self.spaces.borrow();
        let Some(tab) = spaces.iter().flat_map(|s| s.tabs.iter()).find(|t| &t.row == row) else { return };
        let url = tab.pending.borrow_mut().take();
        if let Some(url) = url {
            tab.view.load_uri(&url);
        }
    }

    fn current_space_index(&self) -> usize {
        *self.active.borrow()
    }

    fn selected_tab_index(&self) -> Option<usize> {
        let spaces = self.spaces.borrow();
        let space = spaces.get(self.current_space_index())?;
        let row = space.list.selected_row()?;
        space.tabs.iter().position(|t| t.row == row)
    }

    fn current_view(&self) -> Option<webkit6::WebView> {
        let index = self.selected_tab_index()?;
        Some(self.spaces.borrow()[self.current_space_index()].tabs[index].view.clone())
    }

    fn sync_address(&self) {
        let uri = self.current_view().and_then(|v| v.uri()).unwrap_or_default();
        self.address.set_text(&uri);
    }

    fn save(&self) {
        let spaces = self.spaces.borrow();
        let session = Session {
            active: self.current_space_index(),
            spaces: spaces
                .iter()
                .map(|s| SavedSpace {
                    name: s.name.clone(),
                    urls: s.tabs.iter().filter_map(Tab::url).collect(),
                })
                .collect(),
        };
        let _ = std::fs::create_dir_all(data_dir());
        if let Ok(json) = serde_json::to_string_pretty(&session) {
            let _ = std::fs::write(session_path(), json);
        }
    }

    fn add_space(self: &Rc<Self>, name: &str) -> usize {
        let list = gtk::ListBox::new();
        list.set_selection_mode(gtk::SelectionMode::Browse);
        let this = Rc::downgrade(self);
        list.connect_row_selected(move |_, row| {
            let (Some(this), Some(row)) = (this.upgrade(), row) else { return };
            let page = row.widget_name();
            this.load_if_pending(row);
            this.pages.set_visible_child_name(page.as_str());
            this.sync_address();
        });
        self.lists.add_named(&list, Some(&format!("space-{}", self.spaces.borrow().len())));
        self.spaces.borrow_mut().push(Space { name: name.to_string(), list, tabs: Vec::new() });
        self.spaces.borrow().len() - 1
    }

    fn render_switcher(self: &Rc<Self>) {
        while let Some(child) = self.switcher.first_child() {
            self.switcher.remove(&child);
        }
        let names: Vec<String> = self.spaces.borrow().iter().map(|s| s.name.clone()).collect();
        for (index, name) in names.iter().enumerate() {
            let button = gtk::Button::with_label(name);
            button.add_css_class("flat");
            button.add_css_class("facet-space");
            if index == self.current_space_index() {
                button.add_css_class("active");
            }
            let this = Rc::downgrade(self);
            button.connect_clicked(move |_| {
                if let Some(this) = this.upgrade() {
                    this.switch_space(index);
                }
            });
            self.switcher.append(&button);
        }
    }

    fn switch_space(self: &Rc<Self>, index: usize) {
        if index >= self.spaces.borrow().len() {
            return;
        }
        *self.active.borrow_mut() = index;
        self.lists.set_visible_child_name(&format!("space-{index}"));
        if self.spaces.borrow()[index].tabs.is_empty() {
            self.open_tab(HOME_URL);
        }
        let row = {
            let spaces = self.spaces.borrow();
            spaces[index].list.selected_row().or_else(|| spaces[index].tabs.first().map(|t| t.row.clone()))
        };
        if let Some(row) = row {
            self.pages.set_visible_child_name(row.widget_name().as_str());
            let spaces = self.spaces.borrow();
            spaces[index].list.select_row(Some(&row));
        }
        self.sync_address();
        self.render_switcher();
        self.save();
    }

    fn new_space(self: &Rc<Self>) {
        let number = self.spaces.borrow().len() + 1;
        let index = self.add_space(&format!("Space {number}"));
        self.switch_space(index);
    }

    fn open_tab(self: &Rc<Self>, url: &str) {
        self.add_tab(url, true);
    }

    fn add_tab(self: &Rc<Self>, url: &str, show: bool) {
        let view = webkit6::WebView::builder().network_session(&self.network).build();
        view.set_hexpand(true);
        view.set_vexpand(true);

        let id = {
            let mut next = self.next_id.borrow_mut();
            *next += 1;
            format!("tab-{next}")
        };
        self.pages.add_named(&view, Some(&id));

        let title = gtk::Label::new(Some("New Tab"));
        title.set_xalign(0.0);
        title.set_hexpand(true);
        title.set_ellipsize(gtk::pango::EllipsizeMode::End);
        let close = gtk::Button::from_icon_name("window-close-symbolic");
        close.add_css_class("flat");
        close.add_css_class("facet-tab-close");
        close.set_tooltip_text(Some("Close tab"));
        let line = gtk::Box::new(gtk::Orientation::Horizontal, 6);
        line.append(&title);
        line.append(&close);
        let row = gtk::ListBoxRow::new();
        row.set_widget_name(&id);
        row.set_child(Some(&line));

        if !show {
            title.set_text(glib::Uri::parse(url, glib::UriFlags::NONE).ok().and_then(|u| u.host()).as_deref().unwrap_or(url));
        }
        let space_index = self.current_space_index();
        let pending = (!show).then(|| url.to_string());
        // GTK runs selection handlers synchronously, so widgets are only touched after the borrow ends.
        let list = {
            let mut spaces = self.spaces.borrow_mut();
            let space = &mut spaces[space_index];
            space.tabs.push(Tab { view: view.clone(), row: row.clone(), pending: RefCell::new(pending) });
            space.list.clone()
        };
        list.append(&row);

        view.connect_title_notify(glib::clone!(#[weak] title, move |v| {
            if let Some(text) = v.title().filter(|t| !t.is_empty()) {
                title.set_text(&text);
            }
        }));
        let this = Rc::downgrade(self);
        view.connect_uri_notify(move |v| {
            let Some(this) = this.upgrade() else { return };
            if this.current_view().as_ref() == Some(v) {
                this.sync_address();
            }
        });
        let this = Rc::downgrade(self);
        view.connect_load_changed(move |_, event| {
            let Some(this) = this.upgrade() else { return };
            if event == webkit6::LoadEvent::Finished {
                this.save();
                if this.smoke.replace(false) {
                    println!("first page loaded in {} ms", this.started.elapsed().as_millis());
                    this.run_smoke_script();
                }
            }
        });
        let this = Rc::downgrade(self);
        let closing = row.clone();
        close.connect_clicked(move |_| {
            if let Some(this) = this.upgrade() {
                this.close_row(&closing);
            }
        });

        if show {
            list.select_row(Some(&row));
            view.load_uri(url);
        }
    }

    /// Drives the operations that cross GTK's synchronous signals, then quits.
    fn run_smoke_script(self: &Rc<Self>) {
        self.open_tab("about:blank");
        self.cycle_tab(1);
        self.cycle_tab(-1);
        self.close_current();
        self.new_space();
        self.open_tab("about:blank");
        self.close_current();
        self.close_current();
        self.switch_space(0);
        println!("smoke script ok: {} spaces", self.spaces.borrow().len());
        let window = self.window.clone();
        glib::timeout_add_seconds_local_once(2, move || window.close());
    }

    fn close_row(self: &Rc<Self>, row: &gtk::ListBoxRow) {
        let space_index = self.current_space_index();
        let (tab, list, next) = {
            let mut spaces = self.spaces.borrow_mut();
            let space = &mut spaces[space_index];
            let Some(index) = space.tabs.iter().position(|t| &t.row == row) else { return };
            let tab = space.tabs.remove(index);
            let next = space.tabs.get(index).or_else(|| space.tabs.last()).map(|t| t.row.clone());
            (tab, space.list.clone(), next)
        };
        list.remove(&tab.row);
        self.pages.remove(&tab.view);
        match next {
            Some(next) => list.select_row(Some(&next)),
            None => self.open_tab(HOME_URL),
        }
        self.save();
    }

    fn close_current(self: &Rc<Self>) {
        let row = self.spaces.borrow()[self.current_space_index()].list.selected_row();
        if let Some(row) = row {
            self.close_row(&row);
        }
    }

    fn cycle_tab(&self, delta: i32) {
        let Some(index) = self.selected_tab_index() else { return };
        let spaces = self.spaces.borrow();
        let space = &spaces[self.current_space_index()];
        let count = space.tabs.len() as i32;
        let next = (index as i32 + delta).rem_euclid(count) as usize;
        space.list.select_row(Some(&space.tabs[next].row));
    }

    fn restore(self: &Rc<Self>, url_override: Option<String>) {
        let session: Session = std::fs::read(session_path())
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        if url_override.is_some() || session.spaces.is_empty() {
            self.add_space("Space 1");
            self.open_tab(url_override.as_deref().unwrap_or(HOME_URL));
            self.switch_space(0);
            return;
        }
        for (index, saved) in session.spaces.iter().enumerate() {
            let created = self.add_space(&saved.name);
            *self.active.borrow_mut() = created;
            for url in &saved.urls {
                self.add_tab(url, false);
            }
            debug_assert_eq!(created, index);
        }
        self.switch_space(session.active.min(session.spaces.len() - 1));
    }
}

fn add_action(app: &adw::Application, name: &str, accels: &[&str], run: impl Fn() + 'static) {
    let action = gio::SimpleAction::new(name, None);
    action.connect_activate(move |_, _| run());
    app.add_action(&action);
    app.set_accels_for_action(&format!("app.{name}"), accels);
}

fn build(app: &adw::Application, started: Instant, smoke: bool, url: Option<String>) {
    let css = gtk::CssProvider::new();
    css.load_from_string(include_str!("style.css"));
    gtk::style_context_add_provider_for_display(
        &gdk::Display::default().expect("display"),
        &css,
        gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
    );

    let data = data_dir().join("web");
    let cache = glib::user_cache_dir().join("facet");
    let network = webkit6::NetworkSession::new(data.to_str(), cache.to_str());

    let pages = gtk::Stack::new();
    pages.set_hexpand(true);
    let lists = gtk::Stack::new();
    lists.set_vexpand(true);
    let switcher = gtk::Box::new(gtk::Orientation::Horizontal, 4);

    let address = gtk::Entry::new();
    address.set_hexpand(true);
    address.add_css_class("facet-url");
    address.set_placeholder_text(Some("Search or enter address"));

    let window = adw::ApplicationWindow::new(app);
    window.set_title(Some("Facet"));
    window.set_icon_name(Some(APP_ID));
    window.set_default_size(1280, 800);

    let browser = Rc::new(Browser {
        window: window.clone(),
        pages: pages.clone(),
        lists: lists.clone(),
        switcher: switcher.clone(),
        address: address.clone(),
        network,
        spaces: RefCell::new(Vec::new()),
        active: RefCell::new(0),
        next_id: RefCell::new(0),
        started,
        smoke: RefCell::new(smoke),
    });

    let back = gtk::Button::from_icon_name("go-previous-symbolic");
    let forward = gtk::Button::from_icon_name("go-next-symbolic");
    let reload = gtk::Button::from_icon_name("view-refresh-symbolic");
    for button in [&back, &forward, &reload] {
        button.add_css_class("flat");
    }
    let nav = gtk::Box::new(gtk::Orientation::Horizontal, 2);
    nav.append(&back);
    nav.append(&forward);
    nav.append(&reload);

    let new_tab = gtk::Button::with_label("New Tab");
    new_tab.add_css_class("flat");
    let add_space = gtk::Button::from_icon_name("list-add-symbolic");
    add_space.add_css_class("flat");
    add_space.set_tooltip_text(Some("New Space"));
    let spaces_row = gtk::Box::new(gtk::Orientation::Horizontal, 4);
    spaces_row.append(&switcher);
    spaces_row.append(&add_space);

    let scroller = gtk::ScrolledWindow::new();
    scroller.set_hscrollbar_policy(gtk::PolicyType::Never);
    scroller.set_child(Some(&lists));

    let sidebar = gtk::Box::new(gtk::Orientation::Vertical, 8);
    sidebar.add_css_class("facet-sidebar");
    sidebar.set_size_request(250, -1);
    sidebar.append(&nav);
    sidebar.append(&address);
    sidebar.append(&spaces_row);
    sidebar.append(&scroller);
    sidebar.append(&new_tab);

    let header = adw::HeaderBar::new();
    header.set_title_widget(Some(&gtk::Label::new(Some("Facet"))));
    let content = adw::ToolbarView::new();
    content.add_top_bar(&header);
    let split = gtk::Paned::new(gtk::Orientation::Horizontal);
    split.set_start_child(Some(&sidebar));
    split.set_end_child(Some(&pages));
    split.set_resize_start_child(false);
    split.set_shrink_start_child(false);
    content.set_content(Some(&split));
    window.set_content(Some(&content));

    let b = browser.clone();
    address.connect_activate(move |entry| {
        if let Some(view) = b.current_view() {
            view.load_uri(&resolve_input(&entry.text()));
            view.grab_focus();
        }
    });
    let b = browser.clone();
    back.connect_clicked(move |_| { if let Some(v) = b.current_view() { v.go_back(); } });
    let b = browser.clone();
    forward.connect_clicked(move |_| { if let Some(v) = b.current_view() { v.go_forward(); } });
    let b = browser.clone();
    reload.connect_clicked(move |_| { if let Some(v) = b.current_view() { v.reload(); } });
    let b = browser.clone();
    new_tab.connect_clicked(move |_| b.open_tab(HOME_URL));
    let b = browser.clone();
    add_space.connect_clicked(move |_| b.new_space());

    let b = browser.clone();
    add_action(app, "new-tab", &["<Ctrl>t"], move || { b.open_tab(HOME_URL); b.address.grab_focus(); });
    let b = browser.clone();
    add_action(app, "close-tab", &["<Ctrl>w"], move || b.close_current());
    let b = browser.clone();
    add_action(app, "focus-address", &["<Ctrl>l"], move || { b.address.grab_focus(); });
    let b = browser.clone();
    add_action(app, "reload", &["<Ctrl>r", "F5"], move || { if let Some(v) = b.current_view() { v.reload(); } });
    let b = browser.clone();
    add_action(app, "back", &["<Alt>Left"], move || { if let Some(v) = b.current_view() { v.go_back(); } });
    let b = browser.clone();
    add_action(app, "forward", &["<Alt>Right"], move || { if let Some(v) = b.current_view() { v.go_forward(); } });
    let b = browser.clone();
    add_action(app, "next-tab", &["<Ctrl>Tab"], move || b.cycle_tab(1));
    let b = browser.clone();
    add_action(app, "previous-tab", &["<Ctrl><Shift>Tab"], move || b.cycle_tab(-1));
    let b = browser.clone();
    add_action(app, "new-space", &["<Ctrl><Shift>n"], move || b.new_space());
    let s = sidebar.clone();
    add_action(app, "toggle-sidebar", &["<Ctrl>b"], move || s.set_visible(!s.is_visible()));

    let b = browser.clone();
    window.connect_close_request(move |_| { b.save(); glib::Propagation::Proceed });

    browser.restore(url);
    window.present();
}

fn main() -> glib::ExitCode {
    let started = Instant::now();
    let smoke = std::env::var_os("FACET_SMOKE").is_some();
    let url = std::env::args().nth(1).map(|a| resolve_input(&a));
    let app = adw::Application::builder()
        .application_id(APP_ID)
        .flags(gio::ApplicationFlags::NON_UNIQUE)
        .build();
    app.connect_activate(move |app| build(app, started, smoke, url.clone()));
    app.run_with_args::<&str>(&[])
}
