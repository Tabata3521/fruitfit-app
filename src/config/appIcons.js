export const appIcons = [
  {
    id: "orange",
    label: "Orange",
    preview: "/app-icons/orange.jpg",
    androidAlias: "orange",
    iosAlternateName: "orange",
  },
  {
    id: "pear",
    label: "Pear",
    preview: "/app-icons/pear.jpg",
    androidAlias: "pear",
    iosAlternateName: "pear",
  },
  {
    id: "apple",
    label: "Apple",
    preview: "/app-icons/apple.jpg",
    androidAlias: "apple",
    iosAlternateName: "apple",
  },
  {
    id: "strawberry",
    label: "Strawberry",
    preview: "/app-icons/strawberry.jpg",
    androidAlias: "strawberry",
    iosAlternateName: "strawberry",
  },
];

export const defaultAppIconId = "orange";

export function getAppIconById(id) {
  return appIcons.find((icon) => icon.id === id) || appIcons.find((icon) => icon.id === defaultAppIconId) || appIcons[0];
}
