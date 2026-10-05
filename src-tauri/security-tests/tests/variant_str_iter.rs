use glib::variant::ToVariant;

// RUSTSEC-2024-0429: run in release mode. The unpatched iterator's FFI out
// argument writes through &p instead of &mut p and can become null under optimization.
#[test]
fn strings_survive_forward_and_reverse_iteration() {
    let values = ["zero", "", "Grüße", "video 🦀", "last"];
    let variant = values.to_variant();
    assert_eq!(
        variant.array_iter_str().unwrap().collect::<Vec<_>>(),
        values
    );
    assert_eq!(
        variant.array_iter_str().unwrap().rev().collect::<Vec<_>>(),
        values.into_iter().rev().collect::<Vec<_>>()
    );
}

#[test]
fn mixed_ends_and_indexed_iteration_are_sound() {
    let variant = ["0", "1", "2", "3", "4", "5"].to_variant();
    let mut iter = variant.array_iter_str().unwrap();
    assert_eq!(iter.nth(1), Some("1"));
    assert_eq!(iter.next(), Some("2"));
    assert_eq!(iter.nth_back(1), Some("4"));
    assert_eq!(iter.next_back(), Some("3"));
    assert_eq!(iter.next(), None);
    assert_eq!(iter.next_back(), None);
}

#[test]
fn empty_and_singleton_iterators_terminate() {
    let empty: [&str; 0] = [];
    assert_eq!(empty.to_variant().array_iter_str().unwrap().next(), None);
    assert_eq!(
        ["only"].to_variant().array_iter_str().unwrap().last(),
        Some("only")
    );
}
